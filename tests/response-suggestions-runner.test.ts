import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { ProviderContext } from "../lib/providers/adapters/provider-support";
import { RESPONSE_SUGGESTIONS_PROMPT } from "../lib/response-suggestions";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-response-suggestions-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AI_CHAT_ROOT: dir, AGENT_CWD: dir, AI_CHAT_SECRETS_KEY: "00".repeat(32) });
for (const name of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[name];
after(() => rmSync(dir, { recursive: true, force: true }));

async function fixture() {
  const sqlite = await import("../lib/sqlite");
  const connections = await import("../lib/provider-connections");
  const store = await import("../lib/db-store");
  const jobs = await import("../lib/db-jobs");
  const { codexAdapter } = await import("../lib/providers/adapters/codex");
  const { runAlternativeProviderJob } = await import("../lib/providers/runner");
  const { buildProviderPrompt } = await import("../lib/providers/prompt-context");
  const userId = crypto.randomUUID();
  sqlite.getDatabase().prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(userId, userId, "unused", new Date().toISOString());
  const connection = connections.upsertProviderConnection(userId, { providerKey: "codex", slug: "suggestion-fixture", label: "Suggestion fixture", authType: "api_key", secret: "unused", enabled: true })!;
  const modelId = `codex:${connection.id}:fixture-model`;
  const chat = store.createChat("Suggestions", undefined, userId, { id: modelId });
  const queued = jobs.enqueueJob({ chatId: chat.id, userId, modelId, message: "Erkläre mir die Optionen" });
  const job = jobs.claimNextJob()!;
  assert.equal(job.id, queued.id);
  return { store, jobs, userId, chat, job, codexAdapter, runAlternativeProviderJob, buildProviderPrompt };
}

test("real alternative-provider runner emits and persists clickable suggestions from streamed text", async t => {
  const f = await fixture();
  assert.ok(f.buildProviderPrompt({ job: f.job }).includes(RESPONSE_SUGGESTIONS_PROMPT));
  t.mock.method(f.codexAdapter, "runTurn", async (context: ProviderContext) => {
    context.onText("Ich prüfe die Optionen.\n");
    context.onTool({ id: "inspect", name: "fixture", status: "completed", result: "ok" });
    context.onText("Hier sind die Optionen.\n\n```sug");
    context.onText("gestions\nBeispiel => Zeig mir ein Beispiel.\nVergleiche die Optionen\n```");
    return {};
  });
  await f.runAlternativeProviderJob(f.job, f.chat);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "completed");
  const message = f.store.getChat(f.chat.id)!.messages.at(-1)!;
  const expected = [{ label: "Beispiel", prompt: "Zeig mir ein Beispiel." }, "Vergleiche die Optionen"];
  assert.deepEqual(message.suggestions, expected);
  assert.equal(message.content, "Ich prüfe die Optionen.\nHier sind die Optionen.");
  assert.doesNotMatch(JSON.stringify(message.parts), /```suggestions/);
  assert.deepEqual(message.parts?.map(part => part.type), ["text", "tool", "text"]);
  const events = f.jobs.listRunEvents(f.chat.id, f.userId, 0, f.job.id) as Array<{ id: number; event: string; data: unknown }>;
  assert.deepEqual(events.find(event => event.event === "suggestions")?.data, { suggestions: expected });
  assert.ok(events.findIndex(event => event.event === "suggestions") < events.findIndex(event => event.event === "done"));
});

test("plain completed answers do not fabricate follow-up suggestions", async t => {
  const f = await fixture();
  t.mock.method(f.codexAdapter, "runTurn", async (context: ProviderContext) => {
    context.onText("Erledigt.");
    return {};
  });
  await f.runAlternativeProviderJob(f.job, f.chat);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "completed");
  const message = f.store.getChat(f.chat.id)!.messages.at(-1)!;
  assert.equal(message.content, "Erledigt.");
  assert.equal(message.suggestions, undefined);
  const events = f.jobs.listRunEvents(f.chat.id, f.userId, 0, f.job.id) as Array<{ id: number; event: string; data: unknown }>;
  assert.ok(!events.some(event => event.event === "suggestions"));
});
