import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatMetadataPrompt } from "../lib/chat-metadata-prompt";
import type { AgentJob } from "../lib/jobs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-chat-metadata-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AI_CHAT_ROOT = dataDir;
process.env.AGENT_CWD = dataDir;

const modulesPromise = Promise.all([
  import("../lib/db-store"),
  import("../lib/providers/prompt-context"),
  import("../lib/auth"),
]);
let modules!: Awaited<typeof modulesPromise>;
let ownerId: string;
before(async () => {
  modules = await modulesPromise;
  ownerId = modules[2].createUser("metadata-test-owner", "test-password").id;
});
after(async () => { await rm(dataDir, { recursive: true, force: true }); });

function makeJob(chatId: string, patch: Partial<AgentJob> = {}): AgentJob {
  return { id: "metadata-test-job", chatId, userId: ownerId, message: "Bitte prüfe die automatischen Chat-Namen", status: "running", attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch };
}

test("normal chats request a concise title and keywords before the first response finishes", () => {
  const prompt = chatMetadataPrompt({ titleSource: "default" });
  assert.match(prompt, /silently call update_chat_title/);
  assert.match(prompt, /2-6 word label in the user's language/);
  assert.match(prompt, /before finishing the first response/);
  assert.match(prompt, /update_chat_keywords/);
});

test("explicit and legacy title locks protect manual titles but keep keywords", () => {
  for (const chat of [{ agentTitleLocked: true }, { titleSource: "user" as const }]) {
    const prompt = chatMetadataPrompt(chat);
    assert.match(prompt, /Do not call update_chat_title/);
    assert.doesNotMatch(prompt, /silently call update_chat_title/);
    assert.match(prompt, /update_chat_keywords/);
  }
  assert.match(chatMetadataPrompt({ titleSource: "user", agentTitleLocked: false }), /silently call update_chat_title/);
});

test("incognito at either job or chat level suppresses all metadata instructions", () => {
  assert.equal(chatMetadataPrompt({}, true), "");
  assert.equal(chatMetadataPrompt({ incognito: true }), "");
});

test("actual alternative-provider prompt includes the missing metadata policy", () => {
  const [store, { buildProviderPrompt }] = modules;
  const chat = store.createChat("New chat", undefined, ownerId);
  const prompt = buildProviderPrompt({ job: makeJob(chat.id), toolNames: ["update_chat_title", "update_chat_keywords", "search_chats"] });
  assert.ok(prompt.includes(chatMetadataPrompt(chat)));
  assert.match(prompt, /silently call update_chat_title/);
  store.updateChat(chat.id, { agentTitleLocked: true }, ownerId);
  const locked = buildProviderPrompt({ job: makeJob(chat.id) });
  assert.match(locked, /Do not call update_chat_title/);
  assert.doesNotMatch(locked, /silently call update_chat_title/);
});

test("actual alternative-provider prompts omit metadata maintenance in incognito", () => {
  const [store, { buildProviderPrompt }] = modules;
  const chat = store.createChat("New chat", undefined, ownerId);
  const jobPrompt = buildProviderPrompt({ job: makeJob(chat.id, { incognito: true }) });
  assert.doesNotMatch(jobPrompt, /silently call update_chat_title|Continue maintaining 3-8/);
  const incognitoChat = store.createChat("New chat", undefined, ownerId, undefined, { incognito: true });
  const chatPrompt = buildProviderPrompt({ job: makeJob(incognitoChat.id) });
  assert.doesNotMatch(chatPrompt, /silently call update_chat_title|Continue maintaining 3-8/);
});

test("Cursor and alternative prompts use the same shared metadata policy", () => {
  for (const file of ["lib/worker-runner.ts", "lib/providers/prompt-context.ts"]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.match(source, /import \{ chatMetadataPrompt \} from "@\/lib\/chat-metadata-prompt"/);
    assert.match(source, /chatMetadataPrompt\(chat,/);
  }
});
