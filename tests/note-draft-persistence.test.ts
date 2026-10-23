import assert from "node:assert/strict";
import test from "node:test";
import { createNoteDraftPersistence } from "../lib/note-draft-persistence";
import { clearSavedNoteDraft, type NoteDraft } from "../lib/note-save-state";

function fixture() {
  const storage = new Map<string, string>();
  let draft: NoteDraft = {};
  let writes = 0;
  const persistence = createNoteDraftPersistence(() => {
    writes++;
    if (Object.keys(draft).length) storage.set("note", JSON.stringify(draft));
    else storage.delete("note");
  });
  return {
    storage, persistence,
    edit(next: NoteDraft) { draft = next; persistence.schedule(); },
    saved(patch: NoteDraft) { draft = clearSavedNoteDraft(draft, patch); persistence.flush(); },
    get writes() { return writes; },
  };
}

test("typing batches latest refs with a bounded deadline even during continuous input", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.edit({ content: "A" });
  t.mock.timers.tick(100);
  f.edit({ content: "AB" });
  t.mock.timers.tick(99);
  assert.equal(f.writes, 0);
  assert.equal(f.storage.size, 0);
  f.edit({ content: "ABC", title: "Latest" });
  t.mock.timers.tick(1);
  assert.equal(f.writes, 1);
  assert.deepEqual(JSON.parse(f.storage.get("note")!), { content: "ABC", title: "Latest" });
  f.edit({ content: "ABCD" });
  t.mock.timers.tick(200);
  assert.equal(f.writes, 2);
});

test("flush immediately persists latest state and cancels the scheduled write", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.edit({ content: "A" });
  t.mock.timers.tick(50);
  f.edit({ content: "B" });
  f.persistence.flush();
  assert.equal(f.storage.get("note"), '{"content":"B"}');
  t.mock.timers.tick(1000);
  assert.equal(f.writes, 1);
  // Lifecycle flushes also write when no typing timer is pending.
  f.persistence.flush();
  assert.equal(f.writes, 2);
});

test("cancel discards pending work and permits a fresh batch", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.edit({ content: "discarded" });
  t.mock.timers.tick(100);
  f.persistence.cancel();
  f.edit({ content: "new" });
  t.mock.timers.tick(100);
  assert.equal(f.writes, 0);
  t.mock.timers.tick(100);
  assert.equal(f.storage.get("note"), '{"content":"new"}');
  assert.equal(f.writes, 1);
});

test("saving or clearing removes storage without a stale timer resurrecting the draft", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.edit({ content: "saved" });
  f.persistence.flush();
  f.edit({ content: "saved" });
  f.saved({ content: "saved" });
  assert.equal(f.storage.size, 0);
  const writes = f.writes;
  t.mock.timers.tick(1000);
  assert.equal(f.writes, writes);
  assert.equal(f.storage.size, 0);
  f.edit({ title: "discard me" });
  f.edit({});
  f.persistence.flush();
  t.mock.timers.tick(1000);
  assert.equal(f.storage.size, 0);
});

test("save acknowledgement preserves newer edits and flushes them before the old timer fires", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.edit({ content: "sent" });
  f.persistence.flush();
  f.edit({ content: "newer" });
  f.saved({ content: "sent" });
  assert.equal(f.storage.get("note"), '{"content":"newer"}');
  const writes = f.writes;
  t.mock.timers.tick(1000);
  assert.equal(f.writes, writes);
  assert.equal(f.storage.get("note"), '{"content":"newer"}');
});
