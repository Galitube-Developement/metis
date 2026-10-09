import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-input-lease-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
delete process.env.AI_CHAT_JOB_ID;
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
const loaded = Promise.all([
  import("../lib/auth"), import("../lib/db-store"), import("../lib/db-jobs"),
  import("../lib/db-approvals"), import("../lib/sqlite"), import("../app/api/chat/approval/route"),
  import("../lib/db-questions"), import("../app/api/chat/answer/route"),
]);
let auth!: typeof import("../lib/auth");
let store!: typeof import("../lib/db-store");
let jobs!: typeof import("../lib/db-jobs");
let approvals!: typeof import("../lib/db-approvals");
let sqlite!: typeof import("../lib/sqlite");
let route!: typeof import("../app/api/chat/approval/route");
let questions!: typeof import("../lib/db-questions");
let answerRoute!: typeof import("../app/api/chat/answer/route");
before(async () => { [auth, store, jobs, approvals, sqlite, route, questions, answerRoute] = await loaded; });
after(() => rmSync(dataDir, { recursive: true, force: true }));

function fixture() {
  const name = "lease-" + randomUUID();
  const owner = auth.createUser(name, "test-password");
  const session = auth.authenticateUser(name, "test-password")!;
  const chat = store.createChat("Lease test", undefined, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "test" });
  const claimed = jobs.claimNextJob({ workerId: "original-worker" })!;
  assert.equal(claimed.id, job.id);
  const { approvalId } = approvals.createApproval({ jobId: job.id, chatId: chat.id,
    ownerId: owner.id, title: "Test action", sessionScope: "fixture:command" });
  jobs.updateJob(job.id, { status: "waiting_input" });
  store.updateChat(chat.id, { runStatus: "waiting_for_user", pendingApproval: {
    id: approvalId, title: "Test action", createdAt: new Date().toISOString(),
  } }, owner.id);
  const decide = (decision: string) => route.POST(new Request("http://localhost/api/chat/approval", {
    method: "POST", headers: { cookie: "ai_chat_auth=" + session.token, "content-type": "application/json" },
    body: JSON.stringify({ approvalId, decision }),
  }));
  const stale = new Date(Date.now() - 10_000).toISOString();
  sqlite.getDatabase().prepare("UPDATE pending_approvals SET heartbeat_at = ? WHERE id = ?").run(stale, approvalId);
  return { job, claimed, owner, chat, approvalId, decide, stale, session };
}

for (const decision of ["allow", "deny", "allow-session"]) {
  test(`${decision} with stale approval polling preserves the original writer lease`, async () => {
    const f = fixture();
    try {
      assert.equal((await f.decide(decision)).status, 200);
      assert.equal(jobs.getJob(f.job.id)?.status, "running");
      assert.equal(jobs.getJob(f.job.id)?.attempts, 1);
      assert.equal(jobs.isJobLeaseActive(f.job.id, f.claimed.leaseOwner!, f.claimed.leaseToken!), true);
      assert.equal(jobs.claimNextJob({ workerId: "duplicate-worker" }), null);
      assert.equal(approvals.getApproval(f.approvalId, f.owner.id)?.decision, decision);
    } finally { jobs.updateJob(f.job.id, { status: "cancelled" }); }
  });
}

test("a long user-input pause keeps renewing the same worker lease without changing pause state", () => {
  const f = fixture();
  try {
    for (const status of ["waiting_input", "waiting_for_user"] as const) {
      jobs.updateJob(f.job.id, { status: "running" });
      jobs.updateJob(f.job.id, { status });
      sqlite.getDatabase().prepare("UPDATE job_leases SET expires_at = ? WHERE job_id = ?")
        .run(new Date(Date.now() + 10_000).toISOString(), f.job.id);
      process.env.AI_CHAT_WORKER_ID = f.claimed.leaseOwner;
      process.env.AI_CHAT_JOB_LEASE_TOKEN = f.claimed.leaseToken;
      assert.equal(jobs.touchJob(f.job.id)?.status, status);
      const lease = sqlite.getDatabase().prepare("SELECT expires_at FROM job_leases WHERE job_id = ?")
        .get(f.job.id) as { expires_at: string };
      assert.ok(Date.parse(lease.expires_at) > Date.now() + 110_000);
      process.env.AI_CHAT_JOB_LEASE_TOKEN = "foreign-worker-token";
      assert.equal(jobs.touchJob(f.job.id), null);
      delete process.env.AI_CHAT_WORKER_ID;
      delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
    }
  } finally {
    delete process.env.AI_CHAT_WORKER_ID;
    delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
    jobs.updateJob(f.job.id, { status: "cancelled" });
  }
});

test("an orphaned waiter can resume once after the original lease expires", async () => {
  const f = fixture();
  try {
    sqlite.getDatabase().prepare("UPDATE job_leases SET expires_at = ? WHERE job_id = ?")
      .run(new Date(Date.now() - 1_000).toISOString(), f.job.id);
    assert.equal((await f.decide("allow")).status, 200);
    assert.equal(jobs.getJob(f.job.id)?.status, "queued");
    const resumed = jobs.claimNextJob({ workerId: "resumed-worker" })!;
    assert.equal(resumed.id, f.job.id);
    assert.equal(resumed.attempts, 2);
    assert.notEqual(resumed.leaseToken, f.claimed.leaseToken);
    assert.equal(jobs.claimNextJob(), null);
    assert.equal((await f.decide("allow")).status, 404);
  } finally { jobs.updateJob(f.job.id, { status: "cancelled" }); }
});

test("a leased queued row is skipped so it neither duplicates a writer nor blocks other chats", () => {
  const f = fixture();
  try {
    const db = sqlite.getDatabase();
    db.prepare("UPDATE jobs SET status = 'queued', data = json_set(data, '$.status', 'queued') WHERE id = ?").run(f.job.id);
    const otherChat = store.createChat("Independent", undefined, f.owner.id);
    const other = jobs.enqueueJob({ chatId: otherChat.id, userId: f.owner.id, message: "second" });
    assert.equal(jobs.claimNextJob({ workerId: "other-worker" })?.id, other.id);
    assert.equal(jobs.claimNextJob(), null);
    jobs.updateJob(other.id, { status: "cancelled" });
  } finally { jobs.updateJob(f.job.id, { status: "cancelled" }); }
});

test("resolved requests never reactivate cancelled jobs", () => {
  const f = fixture();
  try {
    jobs.updateJob(f.job.id, { status: "cancelled" });
    assert.equal(jobs.queueUserInputResume({ jobId: f.job.id, heartbeatAt: f.stale, resumePrompt: "resume" }), null);
    assert.equal(jobs.getJob(f.job.id)?.status, "cancelled");
  } finally { jobs.updateJob(f.job.id, { status: "cancelled" }); }
});


test("a stale question response also keeps a live provider run instead of starting a second writer", async () => {
  const f = fixture();
  try {
    approvals.expireApproval(f.approvalId, f.owner.id);
    const question = questions.createPendingQuestion([{ question: "Continue?" }], f.chat.id, f.owner.id, {
      jobId: f.job.id, runId: f.job.id,
    });
    sqlite.getDatabase().prepare("UPDATE pending_questions SET heartbeat_at = ? WHERE question_id = ?")
      .run(f.stale, question.questionId);
    const response = await answerRoute.POST(new Request("http://localhost/api/chat/answer", {
      method: "POST", headers: { cookie: "ai_chat_auth=" + f.session.token, "content-type": "application/json" },
      body: JSON.stringify({ questionId: question.questionId, answers: ["Yes"] }),
    }));
    assert.equal(response.status, 200);
    assert.equal(jobs.getJob(f.job.id)?.status, "waiting_input");
    assert.equal(jobs.isJobLeaseActive(f.job.id, f.claimed.leaseOwner!, f.claimed.leaseToken!), true);
    assert.equal(jobs.claimNextJob(), null);
    assert.equal(jobs.releaseUserInputWait(f.job.id)?.status, "running");
  } finally { jobs.updateJob(f.job.id, { status: "cancelled" }); }
});

test("resolving one request does not release another pending request in the same run", async () => {
  const f = fixture();
  try {
    const second = approvals.createApproval({ jobId: f.job.id, chatId: f.chat.id, ownerId: f.owner.id, title: "Second" });
    assert.equal((await f.decide("allow")).status, 200);
    assert.equal(jobs.getJob(f.job.id)?.status, "waiting_input");
    assert.equal(store.getChat(f.chat.id, f.owner.id)?.pendingApproval?.id, second.approvalId);
    approvals.resolveApproval(second.approvalId, "deny", f.owner.id);
    assert.equal(jobs.releaseUserInputWait(f.job.id)?.status, "running");
  } finally { jobs.updateJob(f.job.id, { status: "cancelled" }); }
});

test("questions have no deadline and legacy overdue questions remain answerable", async () => {
  const f = fixture();
  const pending = questions.createPendingQuestion([{ question: "Continue tomorrow?" }], f.chat.id, f.owner.id);
  try {
    const db = sqlite.getDatabase();
    const row = db.prepare("SELECT expires_at FROM pending_questions WHERE question_id = ?")
      .get(pending.questionId) as { expires_at: string | null };
    assert.equal(row.expires_at, null);
    assert.equal(questions.getPendingQuestion(pending.questionId, f.owner.id)?.expiresAt, undefined);
    // Simulate a question saved by an older version whose deadline passed.
    const overdue = "2000-01-01T00:00:00.000Z";
    db.prepare("UPDATE pending_questions SET expires_at = ?, data = json_set(data, '$.expiresAt', ?) WHERE question_id = ?")
      .run(overdue, overdue, pending.questionId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(questions.getPendingQuestion(pending.questionId, f.owner.id)?.status, "waiting_for_user");
    assert.equal(questions.resolveQuestion(pending.questionId, ["Yes"], "foreign-owner"), false);
    assert.equal(questions.resolveQuestion(pending.questionId, ["Yes"], f.owner.id, 99), false);
    assert.ok(questions.resolveQuestion(pending.questionId, ["Yes"], f.owner.id, pending.version));
    assert.deepEqual(await pending.promise, ["Yes"]);
  } finally { pending.stop(); jobs.updateJob(f.job.id, { status: "cancelled" }); }
});

test("an indefinitely open question can still be cancelled explicitly", async () => {
  const f = fixture();
  const pending = questions.createPendingQuestion([{ question: "Continue?" }], f.chat.id, f.owner.id);
  try {
    assert.ok(questions.cancelQuestion(pending.questionId, f.owner.id));
    assert.deepEqual(await pending.promise, ["[The question was cancelled.]"]);
    assert.equal(questions.resolveQuestion(pending.questionId, ["Yes"], f.owner.id), false);
  } finally { pending.stop(); jobs.updateJob(f.job.id, { status: "cancelled" }); }
});

test("restart recovery preserves old unanswered approvals", async () => {
  const f = fixture();
  try {
    const old = "2000-01-01T00:00:00.000Z";
    sqlite.getDatabase().prepare("UPDATE pending_approvals SET created_at = ?, heartbeat_at = ? WHERE id = ?")
      .run(old, old, f.approvalId);
    jobs.updateJob(f.job.id, { status: "running" });
    jobs.recoverStaleJobs(0);
    assert.equal(approvals.getApproval(f.approvalId, f.owner.id)?.status, "waiting_for_user");
    assert.equal(jobs.getJob(f.job.id)?.status, "waiting_input");
    assert.equal((await f.decide("allow")).status, 200);
    assert.equal(approvals.getApproval(f.approvalId, f.owner.id)?.decision, "allow");
  } finally { jobs.updateJob(f.job.id, { status: "cancelled" }); }
});
