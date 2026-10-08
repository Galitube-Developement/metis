import assert from "node:assert/strict";
import test from "node:test";
import type { SharedNote } from "../lib/store.ts";
import {
  commitNoteDraft,
  clearSavedNoteDraft,
  enqueueNoteSave,
  mergeNoteDraft,
  mergeTodoDraft,
  noteConflictFields,
  stableNoteIdempotencyKey,
} from "../lib/note-save-state.ts";

const note = (overrides = {}) => ({
  id: "n1",
  scope: "global" as const,
  title: "base",
  content: "base content",
  color: "#fef08a",
  position: { x: 0, y: 0 },
  size: { width: 280, height: 220 },
  author: "user" as const,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  archived: false,
  version: 1,
  ...overrides,
});

test("compares 409 fields against confirmed base and preserves non-conflicting drafts", () => {
  const base = note();
  const remote = note({ title: "remote title", content: "base content", version: 2 });
  const draft = { title: "local title", content: "edited content" };
  const conflicts = noteConflictFields(base, draft, remote);
  assert.deepEqual(conflicts.map((item) => item.field), ["title"]);
  assert.equal(mergeNoteDraft(remote, draft).content, "edited content");
});

test("merges todo edits by id instead of replacing the whole array", () => {
  const base = note({ todos: [
    { id: "a", content: "local base", status: "pending" },
    { id: "b", content: "remote base", status: "pending" },
  ] });
  const remote = note({ todos: [
    { id: "a", content: "local base", status: "pending" },
    { id: "b", content: "remote changed", status: "completed" },
    { id: "c", content: "remote new", status: "pending" },
  ], version: 2 });
  const draft = { todos: [
    { id: "a", content: "local changed", status: "completed" as const },
    { id: "b", content: "remote base", status: "pending" as const },
  ] };
  assert.deepEqual(noteConflictFields(base, draft, remote), []);
  assert.deepEqual(mergeTodoDraft(base, draft, remote).todos, [
    { id: "a", content: "local changed", status: "completed" },
    { id: "b", content: "remote changed", status: "completed" },
    { id: "c", content: "remote new", status: "pending" },
  ]);
});

test("serializes saves per note id while allowing different ids to proceed", async () => {
  const queues = new Map<string, Promise<unknown>>();
  const order: string[] = [];
  const first = enqueueNoteSave(queues, "n1", async () => {
    order.push("first-start");
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push("first-end");
  });
  const second = enqueueNoteSave(queues, "n1", async () => order.push("second"));
  const other = enqueueNoteSave(queues, "n2", async () => order.push("other"));
  await Promise.all([first, second, other]);
  assert.deepEqual(order, ["first-start", "other", "first-end", "second"]);
});

test("retries reuse a stable idempotency key", () => {
  assert.equal(stableNoteIdempotencyKey("n1", "7"), "note-update:n1:7");
});

test("network retries repeat the identical version, body and key; CAS rebase changes the key", async () => {
  const calls: Array<{ patch: unknown; version: number; key: string }> = [];
  const result = await commitNoteDraft(note(), { content: "mine" }, async (patch, version, key) => {
    calls.push({ patch, version, key });
    if (calls.length === 1) throw new Error("connection lost after commit");
    if (calls.length === 2) return { status: 409, note: note({ title: "other field", version: 2 }) };
    return { status: 200, note: note({ title: "other field", content: "mine", version: 3 }) };
  });
  assert.deepEqual(calls[0], calls[1]);
  assert.notEqual(calls[1].key, calls[2].key);
  assert.equal(calls[2].version, 2);
  assert.equal(result.note.title, "other field");
  assert.deepEqual(result.conflicts, []);
});

test("a real text conflict sends no blind second write and keeps the local draft", async () => {
  let requests = 0;
  const draft = { content: "local text" };
  const result = await commitNoteDraft(note(), draft, async () => {
    requests++;
    return { status: 409, note: note({ content: "remote text", version: 2 }) };
  });
  assert.equal(requests, 1);
  assert.equal(result.conflicts[0].local, "local text");
  assert.deepEqual(result.originalPatch, draft);
  assert.equal(noteConflictFields(note(), { content: "remote text" }, result.note).length, 0);
});

test("input typed while an old response is pending survives acknowledgment and the next save", async () => {
  const queues = new Map<string, Promise<unknown>>();
  let pending = { content: "first" };
  let confirmed: SharedNote = note();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: Array<{ version: number; content?: string }> = [];
  const save = () => enqueueNoteSave(queues, "n1", async () => {
    const snapshot = { ...pending };
    const result = await commitNoteDraft(confirmed, snapshot, async (patch, version) => {
      calls.push({ version, content: patch.content });
      if (calls.length === 1) await gate;
      return { status: 200, note: note({ ...patch, version: version + 1 }) };
    });
    confirmed = result.note;
    pending = clearSavedNoteDraft(pending, result.originalPatch) as typeof pending;
  });
  const first = save();
  await new Promise(resolve => setTimeout(resolve, 0));
  pending = { content: "first and second" };
  const second = save();
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, [{ version: 1, content: "first" }, { version: 2, content: "first and second" }]);
  assert.equal(confirmed.content, "first and second");
  assert.deepEqual(pending, {});
});

test("choosing either side of a todo conflict retains unrelated local and remote edits", () => {
  const todo = (id: string, content: string) => ({ id, content, status: "pending" as const });
  const base = note({ todos: [todo("a", "base"), todo("b", "base"), todo("c", "base")] });
  const draft = { todos: [todo("a", "local conflict"), todo("b", "local independent"), todo("c", "base")] };
  const remote = note({ todos: [todo("a", "remote conflict"), todo("b", "base"), todo("c", "remote independent")] });
  const conflict = noteConflictFields(base, draft, remote)[0];
  assert.deepEqual(conflict.local, [todo("a", "local conflict"), todo("b", "local independent"), todo("c", "remote independent")]);
  assert.deepEqual(conflict.remote, [todo("a", "remote conflict"), todo("b", "local independent"), todo("c", "remote independent")]);
});

test("offline failure does not mutate the draft and repeated CAS rebases stop", async () => {
  const draft = { content: "keep me" };
  await assert.rejects(commitNoteDraft(note(), draft, async () => { throw new Error("offline"); }), /offline/);
  assert.deepEqual(draft, { content: "keep me" });
  let count = 0;
  await assert.rejects(commitNoteDraft(note(), draft, async () => ({ status: 409, note: note({ title: String(++count), version: count + 1 }) })), /draft is kept/);
  assert.equal(count, 3);
});

test("concurrent project removal uses the same empty value on client and server", () => {
  assert.deepEqual(noteConflictFields(note({ projectId: "p1" }), { projectId: null }, note({ projectId: undefined, version: 2 })), []);
});
