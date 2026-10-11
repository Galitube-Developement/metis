import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(os.tmpdir(), "metis-chat-memory-action-"));
process.env.CHAT_DATA_DIR = dir;
process.env.CHAT_DB_PATH = path.join(dir, "test.sqlite");
process.env.AI_CHAT_ROOT = dir;
let modules: Awaited<ReturnType<typeof setup>>;
async function setup() {
  return Promise.all([import("../lib/auth"), import("../lib/db-store"), import("../lib/chat-memory-actions"), import("../lib/providers/prompt-context")]);
}
before(async () => { modules = await setup(); });
after(() => rmSync(dir, { recursive: true, force: true }));
test("chat memory CRUD reloads in prompts and cannot cross owners/chats", async () => {
  const [auth, store, actions, prompts] = modules;
  const owner = auth.createUser("memory-owner", "test-password").id;
  const other = auth.createUser("memory-other", "test-password").id;
  const chat = store.createChat("Working task", undefined, owner);
  const another = store.createChat("Another task", undefined, owner);
  const response = actions.chatMemoryAction(owner, chat.id, "add", { content: "Use amber artifacts" });
  assert.equal(response.status, 200);
  const { memory } = await response.json();
  const build = () => prompts.buildProviderPrompt({ job: { id: "job", chatId: chat.id, userId: owner, message: "continue", status: "running", attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  assert.match(build(), /amber artifacts/);
  assert.equal(actions.chatMemoryAction(other, chat.id, "edit", { id: memory.id, content: "forged" }).status, 404);
  assert.equal(actions.chatMemoryAction(owner, another.id, "delete", { id: memory.id }).status, 404);
  assert.equal(actions.chatMemoryAction(owner, chat.id, "edit", { id: memory.id, content: "Use jade artifacts" }).status, 200);
  assert.match(build(), /jade artifacts/);
  assert.doesNotMatch(build(), /amber artifacts/);
  assert.equal(store.listMemories(owner).length, 0);
  assert.equal(actions.chatMemoryAction(owner, chat.id, "delete", { id: memory.id }).status, 200);
  assert.doesNotMatch(build(), /jade artifacts/);
});
test("incognito cannot persist chat memories", async () => {
  const [auth, store, actions] = modules;
  const owner = auth.createUser("private-memory-owner", "test-password").id;
  const chat = store.createChat("Private", undefined, owner, undefined, { incognito: true });
  assert.equal(actions.chatMemoryAction(owner, chat.id, "add", { content: "private" }).status, 403);
});
