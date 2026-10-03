import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

const dataDir = path.join(os.tmpdir(), `metis-knowledge-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");

const modulesPromise = Promise.all([
  import("../lib/db-store"),
  import("../lib/shared-context"),
  import("../lib/knowledge-lifecycle"),
]);
let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("extractor does not turn ordinary prompts into global memory", () => {
  const { extractKnowledgeCandidates } = modules[2];
  const profile = extractKnowledgeCandidates("Ich bevorzuge kurze Antworten. Mein Server hat 256 GB RAM.");
  assert.equal(profile.length, 2);
  assert.deepEqual(profile.map((candidate) => candidate.kind), ["durable", "durable"]);
  assert.deepEqual(extractKnowledgeCandidates("Ich will, dass du das bitte fixst."), []);
  assert.deepEqual(extractKnowledgeCandidates("Heute brauche ich 256 GB RAM. Wie viel kostet das?"), []);
  const remembered = extractKnowledgeCandidates("Merk dir: ich bevorzuge kurze Antworten.");
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0]?.kind, "durable");
});

test("extractor keeps scoped project requirements out of global memory", () => {
  const { extractKnowledgeCandidates } = modules[2];
  const [candidate] = extractKnowledgeCandidates("Bei Metis soll Repo-Kontext immer nur on demand geladen werden.");
  assert.equal(candidate?.kind, "task");
  // Long-lived app/project requirements stay task-scoped, not global.
  const [task] = extractKnowledgeCandidates("Die Metis UI soll kompakt bleiben.");
  assert.equal(task?.kind, "task");
});

test("automatic capture stores durable knowledge, is idempotent, and never stores secrets", () => {
  const { createChat, listMemories, getChat } = modules[0];
  const { listNotes } = modules[1];
  const { captureKnowledgeFromUserTurn } = modules[2];
  const chat = createChat("Knowledge lifecycle");

  captureKnowledgeFromUserTurn({ chatId: chat.id, messageId: "m0", message: "Ich will, dass der Composer Drafts speichert." });
  assert.equal(listMemories().filter((m) => m.tags?.includes("auto:knowledge")).length, 0);

  captureKnowledgeFromUserTurn({ chatId: chat.id, messageId: "m1", message: "Merk dir: mein Server hat 256 GB RAM. Die Metis UI soll kompakt bleiben." });
  captureKnowledgeFromUserTurn({ chatId: chat.id, messageId: "m1", message: "Merk dir: mein Server hat 256 GB RAM. Die Metis UI soll kompakt bleiben." });
  assert.equal(listMemories().filter((m) => m.tags?.includes("auto:knowledge")).length, 1);
  assert.equal(listNotes({ chatId: chat.id, scope: "chat" }).filter((n) => n.kind === "learned_fact").length, 1);

  captureKnowledgeFromUserTurn({ chatId: chat.id, messageId: "m2", message: "Merk dir: mein Server hat 512 GB RAM." });
  const auto = listMemories().filter((m) => m.tags?.includes("auto:knowledge"));
  assert.equal(auto.length, 1);
  assert.match(auto[0].content, /512 GB RAM/);

  captureKnowledgeFromUserTurn({ chatId: chat.id, messageId: "m3", message: "Mein API Key ist abc123 und mein Token ist secret. Merk dir mein Passwort abc123." });
  assert.equal(listMemories().some((m) => /abc123|secret/.test(m.content)), false);
  assert.ok((getChat(chat.id)?.keywords || []).includes("server"));
});

test("temporary incident and question reports are not stable profile facts", () => {
  const { extractKnowledgeCandidates } = modules[2];
  for (const message of [
    "Ich habe einen Fehler beim Starten der App.",
    "Ich habe ein Problem beim Einloggen.",
    "Ich habe eine Frage zur Installation.",
    "Mein Server hat einen Fehler beim Starten.",
    "Ich nutze die App und sie funktioniert nicht.",
    "I have an error when starting the app.",
    "I have trouble logging in.",
    "My laptop has a problem opening the app.",
    "I am not working on this because the app is not responding.",
  ]) {
    assert.deepEqual(extractKnowledgeCandidates(message), [], message);
  }
});

test("explicit chat and project scopes take precedence over global preferences", () => {
  const { extractKnowledgeCandidates } = modules[2];
  for (const message of [
    "In diesem Chat bitte antworte immer auf Deutsch.",
    "In diesem Chat bitte antworte auf Deutsch.",
    "In diesem Chat merke dir: ich bevorzuge kurze Antworten.",
    "In diesem Chat nutze ich einen Server mit 256 GB RAM.",
    "Für dieses Projekt bitte formatiere Antworten als Tabelle.",
    "Für dieses Projekt bevorzuge ich kurze Antworten.",
    "In this chat please answer in German.",
    "For this project please format responses as tables.",
    "In this chat remember that I prefer brief replies.",
    "Bei Metis bitte antworte immer mit kopierbaren Befehlen.",
  ]) {
    const candidates = extractKnowledgeCandidates(message);
    assert.equal(candidates.length, 1, message);
    assert.equal(candidates[0]?.kind, "task", message);
  }
});

test("stable profiles and global preferences remain durable", () => {
  const { extractKnowledgeCandidates } = modules[2];
  for (const message of [
    "Ich bevorzuge kurze Antworten.",
    "Ich heiße Beispielnutzer.",
    "Ich wohne in Beispielstadt.",
    "Ich habe einen Laptop mit 32 GB RAM.",
    "Mein Server hat 256 GB RAM.",
    "I prefer concise answers.",
    "My laptop has 32 GB RAM.",
    "Please answer in German by default.",
    "Ich bevorzuge ausführliche Fehlermeldungen.",
    "Merk dir: mein Server hat einen bekannten Fehler beim Starten.",
  ]) {
    assert.equal(extractKnowledgeCandidates(message)[0]?.kind, "durable", message);
  }
  assert.deepEqual(extractKnowledgeCandidates("Ich habe heute einen neuen Laptop."), []);
  assert.deepEqual(extractKnowledgeCandidates("In diesem Chat merk dir mein Passwort review-secret."), []);
});

test("capture persists scoped instructions only as chat facts and ignores incidents", () => {
  const { createChat, listMemories } = modules[0];
  const { listNotes } = modules[1];
  const { captureKnowledgeFromUserTurn } = modules[2];
  const chat = createChat("Scope regression");
  const countBefore = listMemories().length;
  const scoped = "In diesem Chat bitte antworte immer auf Deutsch.";
  const result = captureKnowledgeFromUserTurn({chatId: chat.id, messageId: "scope-regression", message: scoped});
  assert.equal(result.durable, 0);
  assert.equal(result.task, 1);
  assert.equal(listMemories().length, countBefore);
  const facts = listNotes({chatId: chat.id, scope: "chat"}).filter(note => note.kind === "learned_fact");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.content, scoped);
  const otherChat = createChat("Other scope");
  assert.equal(listNotes({chatId: otherChat.id, scope: "chat"}).filter(note => note.kind === "learned_fact").length, 0);
  const incident = captureKnowledgeFromUserTurn({chatId: chat.id, messageId: "incident-regression", message: "Ich habe einen Fehler beim Starten der App."});
  assert.equal(incident.durable, 0);
  assert.equal(incident.task, 0);
  assert.equal(listMemories().length, countBefore);
});
