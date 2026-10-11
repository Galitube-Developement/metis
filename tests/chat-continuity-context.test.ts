import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { AgentJob } from "../lib/jobs";
import { selectChatContinuityFacts } from "../lib/context-layers";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-chat-continuity-"));
process.env.CHAT_DATA_DIR = dir;
process.env.CHAT_DB_PATH = path.join(dir, "chat.sqlite");
process.env.AI_CHAT_ROOT = dir;
process.env.AGENT_CWD = dir;
const pending = Promise.all([
  import("../lib/db-store"), import("../lib/context-scope"),
  import("../lib/providers/prompt-context"), import("../lib/auth"),
  import("../lib/shared-context"), import("../lib/context"),
]);
let m: Awaited<typeof pending>;
let owner: string;
let other: string;
before(async () => {
  m = await pending;
  owner = m[3].createUser("continuity-owner", "test-password").id;
  other = m[3].createUser("continuity-other", "test-password").id;
});
after(async () => { await rm(dir, { recursive: true, force: true }); });
function prompt(chatId: string, patch: Partial<AgentJob> = {}) {
  return m[2].buildProviderPrompt({ job: {
    id: "test", chatId, userId: owner, message: "weiter", status: "running", attempts: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch,
  } });
}

test("persisted chat facts reload for vague resume without global promotion", () => {
  const chat = m[0].createChat("Continuity", undefined, owner);
  const globalBefore = m[0].listMemories(owner);
  const fact = m[1].addLearnedFact(owner, chat.id, { id: "chosen", content: "Chosen artifact is amber-package." });
  assert.ok(fact);
  assert.equal(m[4].getNote(fact.id, owner)?.content, fact.content);
  assert.equal(m[1].addLearnedFact(owner, chat.id, { id: "chosen", content: "retry" })?.id, fact.id);
  assert.match(prompt(chat.id), /amber-package/);
  // A new prompt after native session state disappears still reads durable facts.
  m[0].updateChat(chat.id, { sessionState: { providerSessions: {} } }, owner);
  assert.match(prompt(chat.id), /amber-package/);
  m[4].updateNote(fact.id, { content: "Corrected artifact is jade-package.", ownerId: owner });
  assert.match(prompt(chat.id), /jade-package/);
  assert.doesNotMatch(prompt(chat.id), /amber-package/);
  assert.deepEqual(m[0].listMemories(owner), globalBefore);
  m[4].deleteNote(fact.id, owner);
  assert.doesNotMatch(prompt(chat.id), /jade-package/);
});

test("owner and chat isolation apply to facts and explicit note references", () => {
  const a = m[0].createChat("A", undefined, owner);
  const b = m[0].createChat("B", undefined, owner);
  const c = m[0].createChat("C", undefined, other);
  const fact = m[1].addLearnedFact(owner, a.id, { content: "private-a-marker" })!;
  m[1].addLearnedFact(other, c.id, { content: "private-c-marker" });
  assert.doesNotMatch(prompt(b.id), /private-a-marker|private-c-marker/);
  assert.doesNotMatch(prompt(a.id, { userId: other }), /private-a-marker/);
  assert.equal(m[1].loadContextScope({ chatId: a.id, ownerId: other }), null);
  assert.equal(m[1].addLearnedFact(other, a.id, { content: "forged" }), null);
  const refs = [{ kind: "note" as const, id: fact.id, label: "forged", content: "private-a-marker" }];
  assert.deepEqual(m[5].resolveReferences(owner, b.id, refs), []);
  assert.deepEqual(m[1].resolveScopeReferences(owner, b.id, refs.map(r => ({ ...r, source: "explicit" as const }))), []);
  assert.doesNotMatch(prompt(b.id, { references: refs }), /private-a-marker/);
  assert.match(prompt(a.id, { userId: undefined }), /private-a-marker/);
});

test("incognito and archived facts stay outside continuity", () => {
  const chat = m[0].createChat("Normal", undefined, owner);
  const fact = m[1].addLearnedFact(owner, chat.id, { content: "hidden-marker" })!;
  assert.doesNotMatch(prompt(chat.id, { incognito: true }), /hidden-marker/);
  m[4].updateNote(fact.id, { archived: true, ownerId: owner });
  assert.doesNotMatch(prompt(chat.id), /hidden-marker/);
  const privateChat = m[0].createChat("Private", undefined, owner, undefined, { incognito: true });
  assert.equal(m[1].addLearnedFact(owner, privateChat.id, { content: "hidden-marker" }), null);
});

test("continuity stays bounded and retains recent state alongside relevant facts", () => {
  const facts = Array.from({ length: 30 }, (_, index) => ({
    id: String(index), content: index === 0 ? "specific needle" : "other state",
    updatedAt: new Date(index * 1000).toISOString(),
  }));
  const selected = selectChatContinuityFacts("needle", facts);
  assert.equal(selected.length, 8);
  assert.ok(selected.some(f => f.id === "0"));
  assert.ok(selected.some(f => f.id === "29"));
  assert.equal(selectChatContinuityFacts("weiter", facts).length, 8);
  assert.deepEqual(selectChatContinuityFacts("weiter", facts, 0), []);
});

test("prompt bounds chat facts and leaves unrelated global memories out", () => {
  const chat = m[0].createChat("Bounded", undefined, owner);
  m[0].createMemory("Unrelated global saxophone-marker", [], owner);
  for (let index = 0; index < 15; index++) {
    m[1].addLearnedFact(owner, chat.id, { content: `continuity-budget-marker-${index} ` + "x".repeat(2000) });
  }
  const result = prompt(chat.id);
  assert.doesNotMatch(result, /saxophone-marker/);
  const block = result.split("Chat working memory:\n")[1].split("This bounded context")[0];
  assert.ok(block.length <= 10002);
  assert.ok((block.match(/continuity-budget-marker/g) || []).length <= 8);
});
