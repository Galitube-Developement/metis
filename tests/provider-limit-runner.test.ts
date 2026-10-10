import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { ProviderContext } from "../lib/providers/adapters/provider-support";
const dir = mkdtempSync(path.join(os.tmpdir(), "metis-limit-runner-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"),
  AI_CHAT_ROOT: dir, AGENT_CWD: dir, AI_CHAT_PROVIDER_LIMIT_WAITER: "1", AI_CHAT_SECRETS_KEY: "00".repeat(32) });
for (const name of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[name];
after(() => rmSync(dir, { recursive: true, force: true }));
async function fixture(t: import("node:test").TestContext) {
  const sqlite = await import("../lib/sqlite");
  const connections = await import("../lib/provider-connections");
  const store = await import("../lib/db-store");
  const jobs = await import("../lib/db-jobs");
  const { codexAdapter } = await import("../lib/providers/adapters/codex");
  const { runAlternativeProviderJob } = await import("../lib/providers/runner");
  const settings = await import("../lib/provider-rate-limit-settings");
  const sessions = await import("../lib/providers/session-bindings");
  const userId = crypto.randomUUID();
  sqlite.getDatabase().prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, userId, "unused", new Date().toISOString());
  const connection = connections.upsertProviderConnection(userId, { providerKey: "codex", slug: "limit-fixture", label: "Limit fixture", authType: "api_key", secret: "unused", enabled: true });
  assert.ok(connection);
  const modelId = `codex:${connection.id}:fixture-model`;
  const chat = store.createChat("Limit fixture", undefined, userId, { id: modelId });
  const queued = jobs.enqueueJob({ chatId: chat.id, userId, modelId, message: "Continue durable task" });
  const job = jobs.claimNextJob()!;
  assert.equal(job.id, queued.id);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-10T10:00:00Z") });
  return { store, jobs, settings, sessions, connection, userId, chat, job, codexAdapter, runAlternativeProviderJob };
}
test("real provider runner checkpoints progress, exits on limit and automatically continues the same job", async t => {
  const f = await fixture(t);
  let calls = 0;
  t.mock.method(f.codexAdapter, "runTurn", async (context: ProviderContext) => {
    calls++;
    if (calls === 1) {
      f.sessions.updateProviderSessionBinding({ chatId: f.chat.id, ownerId: f.userId, execution: "codex-sdk", connectionId: f.connection.id, contextOwner: "native", candidateCursor: "persistent-thread", promoteCursor: true });
      context.onText("First completed step.");
      context.onTool({ id: "completed-tool", name: "fixture", status: "completed", result: "Saved output" });
      throw new Error("Limit", { cause: { statusCode: 429, responseHeaders: { "retry-after": "18000" } } });
    }
    assert.equal(f.sessions.getProviderSessionBinding(context.chat, "codex-sdk", f.connection.id)?.lastKnownGoodCursor, "persistent-thread");
    assert.match(context.job.resumePrompt!, /same run/);
    context.onText("Remaining step completed.");
    return { agentId: "codex:persistent-thread" };
  });
  await f.runAlternativeProviderJob(f.job, f.chat);
  const paused = f.jobs.getJob(f.job.id)!;
  assert.equal(paused.status, "queued");
  assert.equal(calls, 1);
  assert.equal(f.jobs.claimNextJob(), null);
  const progress = f.store.getChat(f.chat.id)!.messages.at(-1)!;
  assert.equal(progress.content, "First completed step.");
  assert.equal(progress.errorMessage, undefined);
  assert.equal(progress.tools?.[0]?.status, "completed");
  t.mock.timers.tick(5 * 3600000);
  const resumed = f.jobs.claimNextJob()!;
  assert.equal(resumed.id, f.job.id);
  await f.runAlternativeProviderJob(resumed, f.store.getChat(f.chat.id)!);
  assert.equal(calls, 2);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "completed");
  assert.equal(f.store.getChat(f.chat.id)?.messages.at(-1)?.content, "Remaining step completed.");
});
for (const scenario of ["disabled", "foreign", "unknown-reset"] as const) {
  test(`real provider runner fails without retry when ${scenario}`, async t => {
    const f = await fixture(t);
    if (scenario === "disabled") f.settings.saveProviderLimitResumeEnabled(f.userId, false);
    let calls = 0;
    t.mock.method(f.codexAdapter, "runTurn", async () => {
      calls++;
      if (scenario === "foreign") throw new Error("permission denied");
      throw new Error("provider failure", { cause: { statusCode: 429,
        ...(scenario === "disabled" ? { responseHeaders: { "retry-after": "18000" } } : {}) } });
    });
    await f.runAlternativeProviderJob(f.job, f.chat);
    assert.equal(calls, 1);
    assert.equal(f.jobs.getJob(f.job.id)?.status, "error");
    assert.equal(f.jobs.claimNextJob(), null);
  });
}
test("AI SDK error-stream wrapping preserves real Retry-After evidence", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-10T10:00:00Z") });
  const { consumeAiStream } = await import("../lib/providers/adapters/provider-support");
  const { providerRateLimit } = await import("../lib/provider-rate-limit");
  const stream = { stream: (async function* () {
    yield { type: "error", error: Object.assign(new Error("API limit"), { statusCode: 429, responseHeaders: { "retry-after": "18000" } }) };
  })(), usage: Promise.resolve({}) } as unknown as Parameters<typeof consumeAiStream>[0];
  const context = { onText() {}, onStream() {}, onTool() {} } as unknown as ProviderContext;
  await assert.rejects(consumeAiStream(stream, context, {}, []), error => {
    assert.equal(providerRateLimit(error)?.resetAt, "2026-10-10T15:00:00.000Z");
    return true;
  });
});
