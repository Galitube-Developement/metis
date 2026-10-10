import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test, { after, afterEach, before } from "node:test";
import { providerRateLimit } from "../lib/provider-rate-limit";
import { waitForSchedulerTick } from "../lib/worker-scheduler";
const dir = mkdtempSync(path.join(os.tmpdir(), "metis-limit-runtime-"));
process.env.CHAT_DATA_DIR = dir;
process.env.CHAT_DB_PATH = path.join(dir, "chat.sqlite");
process.env.AI_CHAT_ROOT = dir;
process.env.AI_CHAT_PROVIDER_LIMIT_WAITER = "1";
process.env.AGENT_CWD = dir;
for (const key of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[key];
let jobs!: typeof import("../lib/db-jobs");
let store!: typeof import("../lib/db-store");
let sqlite!: typeof import("../lib/sqlite");
let settings!: typeof import("../lib/provider-rate-limit-settings");
let sessions!: typeof import("../lib/providers/session-bindings");
before(async () => { [jobs, store, sqlite, settings, sessions] = await Promise.all([
  import("../lib/db-jobs"), import("../lib/db-store"), import("../lib/sqlite"),
  import("../lib/provider-rate-limit-settings"), import("../lib/providers/session-bindings"),
]); });
after(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => { for (const job of jobs.listJobs()) if (["queued", "running"].includes(job.status)) jobs.updateJob(job.id, { status: "cancelled" }); });
const start = Date.parse("2026-10-10T10:00:00Z");
const reset = start + 5 * 3600000;
const evidence = () => ({ statusCode: 429, responseHeaders: { "retry-after": "18000" } });
function fixture() {
  const chat = store.createChat("Provider limit");
  const job = jobs.enqueueJob({ chatId: chat.id, message: "continue task" });
  const claimed = jobs.claimNextJob({ workerId: "worker-a" })!;
  assert.equal(claimed.id, job.id);
  return { chat, job, claimed };
}
test("five-hour durable pause frees capacity, survives another process and resumes the same run/session", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const f = fixture();
  jobs.updateJob(f.job.id, { runId: "original-run", agentId: "native-session", agentRuntimeDeadlineAt: new Date(start + 60000).toISOString() });
  sessions.updateProviderSessionBinding({ chatId: f.chat.id, execution: "codex-sdk", connectionId: "fixture", contextOwner: "native", candidateCursor: "native-session", promoteCursor: true });
  const active = new Set<Promise<unknown>>();
  const task = Promise.resolve().then(() => {
    assert.ok(jobs.deferProviderLimitedJob(f.job.id, evidence()));
  });
  active.add(task);
  assert.equal(await waitForSchedulerTick(active, 1, 18000000), "slot-freed");
  active.delete(task);
  assert.equal(active.size, 0);
  assert.equal(jobs.getJob(f.job.id)?.status, "queued");
  assert.equal(sqlite.getDatabase().prepare("SELECT count(*) AS n FROM job_leases WHERE job_id = ?").get(f.job.id)?.n, 0);
  assert.equal(store.getChat(f.chat.id)?.runStatus, "paused");
  assert.ok(store.getChat(f.chat.id)?.queueMessage?.includes(new Date(reset).toISOString()));
  assert.equal(jobs.claimNextJob(), null);
  const child = spawnSync(process.execPath, ["--import", "tsx", "-e",
    `const {getJob,recoverStaleJobs}=require('./lib/db-jobs.ts'); const j=getJob('${f.job.id}'); if(j.status!=='queued'||j.providerRateLimit.resetAt!=='${new Date(reset).toISOString()}')process.exit(1); recoverStaleJobs(0); console.log('DURABLE_WAIT_RELOADED');`],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /DURABLE_WAIT_RELOADED/);
  const other = fixture(); // another chat takes the only free slot immediately
  jobs.updateJob(other.job.id, { status: "completed" });
  t.mock.timers.setTime(reset - 1);
  assert.equal(jobs.claimNextJob(), null);
  t.mock.timers.setTime(reset);
  const resumed = jobs.claimNextJob({ workerId: "worker-b" })!;
  assert.equal(resumed.id, f.job.id);
  assert.equal(resumed.attempts, 2);
  assert.equal(resumed.runId, "original-run");
  assert.equal(resumed.agentId, "native-session");
  assert.match(resumed.resumePrompt!, /same run/);
  assert.equal((resumed as unknown as { providerRateLimit?: unknown }).providerRateLimit, undefined);
  assert.equal(resumed.agentRuntimeDeadlineAt, new Date(reset + 60000).toISOString());
  assert.equal(sessions.getProviderSessionBinding(store.getChat(f.chat.id), "codex-sdk", "fixture")?.lastKnownGoodCursor, "native-session");
  assert.equal(jobs.claimNextJob({ workerId: "worker-c" }), null); // atomic claim
  jobs.updateJob(resumed.id, { status: "completed" });
});
test("cancelled waits never resume after reset", t => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const f = fixture();
  assert.ok(jobs.deferProviderLimitedJob(f.job.id, evidence()));
  jobs.cancelAgentJob(f.job.id);
  t.mock.timers.setTime(reset + 1);
  assert.equal(jobs.claimNextJob(), null);
  assert.equal(jobs.getJob(f.job.id)?.status, "cancelled");
});
test("missing reset, unrelated errors and disabled setting do not change the running job", t => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const f = fixture();
  for (const error of [new Error("MCP timed out"), { statusCode: 429 }, { statusCode: 503, responseHeaders: { "retry-after": "18000" } }]) {
    assert.equal(jobs.deferProviderLimitedJob(f.job.id, error), null);
    assert.equal(jobs.getJob(f.job.id)?.status, "running");
  }
  sqlite.getDatabase().prepare("INSERT INTO settings (key, owner_id, data) VALUES (?, NULL, ?)").run("provider-limit-resume:legacy", '{"enabled":false}');
  assert.equal(settings.getProviderLimitResumeEnabled(), false);
  assert.equal(jobs.deferProviderLimitedJob(f.job.id, evidence()), null);
  sqlite.getDatabase().prepare("DELETE FROM settings WHERE key = ?").run("provider-limit-resume:legacy");
  jobs.updateJob(f.job.id, { status: "cancelled" });
});
test("stale worker cannot requeue a cancelled run or publish pause events", t => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const f = fixture();
  process.env.AI_CHAT_JOB_ID = f.job.id;
  process.env.AI_CHAT_WORKER_ID = f.claimed.leaseOwner;
  process.env.AI_CHAT_JOB_LEASE_TOKEN = "wrong-token";
  try { assert.equal(jobs.deferProviderLimitedJob(f.job.id, evidence()), null); }
  finally { for (const key of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[key]; }
  assert.equal(jobs.getJob(f.job.id)?.status, "running");
  jobs.updateJob(f.job.id, { status: "cancelled" });
  assert.equal(jobs.deferProviderLimitedJob(f.job.id, evidence()), null);
});
test("reset parser uses actual fields, SDK causes and explicit zones; never assumes a tariff", () => {
  assert.equal(providerRateLimit({ code: "rate_limit_exceeded", resetsAt: reset / 1000 }, start)?.resetAt, new Date(reset).toISOString());
  assert.equal(providerRateLimit(new Error("SDK", { cause: evidence() }), start)?.resetAt, new Date(reset).toISOString());
  assert.equal(providerRateLimit(new Error("You've hit your usage limit. Try again at 2026-10-10T15:00:00Z"), start)?.resetAt, new Date(reset).toISOString());
  assert.equal(providerRateLimit(new Error("You've hit your usage limit. Try again at 3 PM"), start), null);
  assert.equal(providerRateLimit({ code: "rate_limit_exceeded", resetAt: start / 1000 }, start), null);
  assert.equal(providerRateLimit({ code: "permission_denied", resetAt: reset / 1000 }, start), null);
});
test("late child exit and old runtime expiry cannot destroy the committed pause", t => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const f = fixture();
  assert.ok(jobs.deferProviderLimitedJob(f.job.id, evidence()));
  // Supervising worker reports an exit after the child committed and dropped its lease.
  assert.throws(() => jobs.updateJob(f.job.id, { status: "error", error: "child exited" }), /stale worker exit/);
  assert.equal(jobs.cancelAgentJob(f.job.id, undefined, "old deadline", "runtime_limit")?.status, "queued");
  assert.equal(jobs.getJob(f.job.id)?.status, "queued");
  t.mock.timers.setTime(reset);
  assert.equal(jobs.claimNextJob()?.id, f.job.id);
  jobs.cancelAgentJob(f.job.id);
});
test("production compatibility gate prevents deferred work under an old scheduler", t => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const f = fixture();
  const testEnvironment = process.env as Record<string, string | undefined>;
  const previousNodeEnv = testEnvironment.NODE_ENV;
  const previousSupport = process.env.AI_CHAT_PROVIDER_LIMIT_WAITER;
  try {
    testEnvironment.NODE_ENV = "production";
    delete process.env.AI_CHAT_PROVIDER_LIMIT_WAITER;
    assert.equal(jobs.deferProviderLimitedJob(f.job.id, evidence()), null);
    assert.equal(jobs.getJob(f.job.id)?.status, "running");
    process.env.AI_CHAT_PROVIDER_LIMIT_WAITER = "1";
    assert.ok(jobs.deferProviderLimitedJob(f.job.id, evidence()));
  } finally {
    if (previousNodeEnv === undefined) delete testEnvironment.NODE_ENV; else testEnvironment.NODE_ENV = previousNodeEnv;
    if (previousSupport === undefined) delete process.env.AI_CHAT_PROVIDER_LIMIT_WAITER; else process.env.AI_CHAT_PROVIDER_LIMIT_WAITER = previousSupport;
  }
});
