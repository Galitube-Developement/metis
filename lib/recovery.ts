import { getDatabase } from "@/lib/sqlite";
import { createSnapshot, getLatestSnapshot, SNAPSHOT_SCHEMA_VERSION } from "@/lib/shared-context";
import type { AgentJob } from "@/lib/jobs";
import type { SessionSnapshot } from "@/lib/store";

const LIVE_JOB_STATUSES = new Set(["queued", "running", "waiting_input", "waiting_for_user"]);
const STALE_RUNNING_MS = 90_000;

function emptySnapshot(chatId: string, ownerId?: string): SessionSnapshot {
  const timestamp = new Date().toISOString();
  return {
    id: "",
    chatId,
    ...(ownerId ? { ownerId } : {}),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    checkpoint: "recovery",
    runStatus: "idle",
    availability: "not_available",
  };
}

function isFresh(job: AgentJob, maxAgeMs = STALE_RUNNING_MS) {
  const updatedAt = Date.parse(job.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt < maxAgeMs;
}

export function snapshotInterruptedJob(job: AgentJob) {
  return createSnapshot({
    chatId: job.chatId,
    ...(job.userId ? { ownerId: job.userId } : {}),
    checkpoint: "recovery",
    runStatus: "interrupted",
    resumeMarker: {
      jobId: job.id,
      runId: job.runId || job.id,
      safe: Boolean(job.agentId),
      reason: job.error || "Run interrupted by a worker restart; manual resume is required.",
    },
    availability: "needs_attention",
  });
}

export function resolveRecoverySnapshot(chatId: string, ownerId?: string): SessionSnapshot | null {
  const snapshot = getLatestSnapshot(chatId, ownerId);
  // Only the latest, live and stale-running candidates affect recovery. Do not
  // deserialize every completed job (and its embedded prompts/tool payloads).
  const db=getDatabase(),scope=ownerId?"AND user_id=?":"",args=ownerId?[chatId,ownerId]:[chatId];
  const cutoff=new Date(Date.now()-STALE_RUNNING_MS).toISOString();
  const select=`SELECT id,chat_id AS chatId,user_id AS userId,status,updated_at AS updatedAt,
    json_extract(data,\'$.runId\') AS runId,json_extract(data,\'$.agentId\') AS agentId,
    json_extract(data,\'$.error\') AS error FROM jobs WHERE chat_id=? ${scope}`;
  const latest=db.prepare(select+" ORDER BY updated_at DESC LIMIT 1").get(...args) as AgentJob|undefined;
  const live=db.prepare(select+" AND (status IN (\'queued\',\'waiting_input\',\'waiting_for_user\') OR (status=\'running\' AND updated_at>=?)) ORDER BY updated_at DESC LIMIT 1").get(...args,cutoff) as AgentJob|undefined;
  const stale=db.prepare(select+" AND status=\'running\' AND updated_at<? ORDER BY updated_at DESC LIMIT 1").get(...args,cutoff) as AgentJob|undefined;
  const jobs=[...new Map([latest,live,stale].filter((job):job is AgentJob=>!!job).map(job=>[job.id,job])).values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const latestJob = jobs[0] ?? null;
  const liveJob = jobs.find((job) => {
    if (!LIVE_JOB_STATUSES.has(job.status)) return false;
    return job.status !== "running" || isFresh(job);
  });

  if (liveJob) {
    return {
      ...(snapshot ?? emptySnapshot(chatId, ownerId)),
      runStatus: liveJob.status === "waiting_input" || liveJob.status === "waiting_for_user"
        ? "waiting_for_user"
        : "running",
      availability: "available",
      resumeMarker: {
        jobId: liveJob.id,
        runId: liveJob.runId || liveJob.id,
        safe: true,
        reason: "Run is currently active.",
      },
    };
  }

  const zombie = jobs.find((job) => job.status === "running" && !isFresh(job));
  const interruptedJob = latestJob?.status === "interrupted" ? latestJob : zombie ?? null;

  if (interruptedJob) {
    const dismissed = Boolean(
      snapshot &&
      snapshot.availability !== "needs_attention" &&
      snapshot.updatedAt > interruptedJob.updatedAt,
    );
    if (dismissed) {
      return { ...snapshot!, availability: "available" };
    }
    return {
      ...(snapshot ?? emptySnapshot(chatId, ownerId)),
      checkpoint: "recovery",
      runStatus: "interrupted",
      availability: "needs_attention",
      resumeMarker: {
        jobId: interruptedJob.id,
        runId: interruptedJob.runId || interruptedJob.id,
        safe: Boolean(interruptedJob.agentId),
        reason: interruptedJob.error || "The last run was interrupted by a restart.",
      },
    };
  }

  if (!snapshot) return null;
  if (snapshot.availability === "needs_attention" || snapshot.runStatus === "running") {
    return {
      ...snapshot,
      availability: "available",
      runStatus: snapshot.runStatus === "running" ? "idle" : snapshot.runStatus,
      resumeMarker: snapshot.resumeMarker
        ? { ...snapshot.resumeMarker, safe: true }
        : undefined,
    };
  }
  return snapshot;
}
