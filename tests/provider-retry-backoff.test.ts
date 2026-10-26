import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as flushPromises } from "node:timers/promises";
import test, { after } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-retry-backoff-"));
Object.assign(process.env, {
  CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AI_CHAT_ROOT: dir, AGENT_CWD: dir,
});
for (const name of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[name];
after(() => rmSync(dir, { recursive: true, force: true }));

async function fixture() {
  const [sqlite, store, jobs, settings, retries] = await Promise.all([
    import("../lib/sqlite"), import("../lib/db-store"), import("../lib/db-jobs"),
    import("../lib/provider-retry-settings"), import("../lib/provider-retry-runner"),
  ]);
  const userId = crypto.randomUUID();
  sqlite.getDatabase().prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, userId, "unused", new Date().toISOString());
  const chat = store.createChat("Retry backoff", undefined, userId);
  settings.saveProviderRetryEnabled(userId, true);
  const queued = jobs.enqueueJob({ chatId: chat.id, userId, message: "Finish the task" });
  const job = jobs.claimNextJob({ workerId: "backoff-worker" })!;
  assert.equal(job.id, queued.id);
  return { sqlite, store, jobs, settings, retries, job, userId };
}

async function advance(t: import("node:test").TestContext, ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 250) {
    t.mock.timers.tick(Math.min(250, ms - elapsed));
    await flushPromises();
  }
}

test("retries wait 1, 2 and 4 seconds after cleanup without changing the runtime budget", async t => {
  const f = await fixture();
  const start = Date.now();
  const deadline = new Date(start + 60000).toISOString();
  const job = f.jobs.updateJob(f.job.id, { agentRuntimeDeadlineAt: deadline })!;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: start });
  const attempts: number[] = [];
  let cleaned = true;
  const run = f.retries.runWithProviderRetries(job, async current => {
    assert.equal(cleaned, true, "cleanup must finish before the next attempt");
    cleaned = false;
    attempts.push(Date.now() - start);
    if (attempts.length < 4) {
      assert.equal(f.retries.requestProviderRetry(current.id, new Error("Model is under capacity"), () => {}), true);
    } else f.jobs.updateJob(current.id, { status: "completed" });
    cleaned = true;
  });
  await flushPromises();
  assert.deepEqual(attempts, [0]);
  await advance(t, 750);
  assert.deepEqual(attempts, [0]);
  await advance(t, 250);
  assert.deepEqual(attempts, [0, 1000]);
  await advance(t, 1750);
  assert.equal(attempts.length, 2);
  await advance(t, 250);
  assert.deepEqual(attempts, [0, 1000, 3000]);
  await advance(t, 3750);
  assert.equal(attempts.length, 3);
  await advance(t, 250);
  await run;
  assert.deepEqual(attempts, [0, 1000, 3000, 7000]);
  assert.equal(f.jobs.getJob(job.id)?.agentRuntimeDeadlineAt, deadline);
});

test("Stop during backoff prevents another provider call within the next poll", async t => {
  const f = await fixture();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  let attempts = 0;
  const run = f.retries.runWithProviderRetries(f.job, async current => {
    attempts++;
    assert.equal(f.retries.requestProviderRetry(current.id, new Error("Model is under capacity"), () => {}), true);
  });
  await flushPromises();
  f.jobs.cancelAgentJob(f.job.id, f.userId);
  await advance(t, 250);
  await run;
  assert.equal(attempts, 1);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "cancelled");
});

test("losing the worker lease during backoff prevents another provider call", async t => {
  const f = await fixture();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  Object.assign(process.env, {
    AI_CHAT_JOB_ID: f.job.id, AI_CHAT_WORKER_ID: f.job.leaseOwner,
    AI_CHAT_JOB_LEASE_TOKEN: f.job.leaseToken,
  });
  let attempts = 0;
  try {
    const run = f.retries.runWithProviderRetries(f.job, async current => {
      attempts++;
      assert.equal(f.retries.requestProviderRetry(current.id, new Error("Model is under capacity"), () => {}), true);
    });
    await flushPromises();
    f.sqlite.getDatabase().prepare("DELETE FROM job_leases WHERE job_id = ?").run(f.job.id);
    await advance(t, 250);
    await run;
    assert.equal(attempts, 1);
  } finally {
    for (const name of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[name];
    f.jobs.cancelAgentJob(f.job.id, f.userId);
  }
});
