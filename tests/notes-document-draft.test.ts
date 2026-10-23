import assert from "node:assert/strict";
import test from "node:test";
import { applyDocumentPatch, possibleDocumentSave, uncertainDocumentConflicts } from "../lib/notes-document-draft";
import { clearSavedNoteDraft, commitNoteDraft, mergeNoteDraft, type NoteDraft } from "../lib/note-save-state";
import type { SharedNote } from "../lib/store";
const base = {id:"n",title:"Original",content:"A",version:1} as SharedNote;
test("lost acknowledgments followed by undo keep A through retry, reload and explicit conflict resolution", async () => {
  let server = { ...base };
  let draft: NoteDraft = { content: "B" };
  const pending = { ...draft };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  const failed = commitNoteDraft(base, pending, async patch => {
    attempts++;
    if (attempts === 1) {
      server = { ...server, ...patch, version: 2 } as SharedNote;
      await gate;
    }
    throw new Error("reply lost after commit");
  });
  draft = applyDocumentPatch(base, draft, { content: "A" }, pending);
  release();
  await assert.rejects(() => failed, /reply lost/);
  const possible = possibleDocumentSave(base, {}, pending);
  assert.deepEqual(possible, { content: "B" });
  const restored = JSON.parse(JSON.stringify({ base, draft, possible })) as { base: SharedNote; draft: NoteDraft; possible: NoteDraft };
  // Even another undo while A is retried must retain the earlier possible B write.
  const retrying = possibleDocumentSave(restored.base, restored.possible, restored.draft);
  restored.draft = applyDocumentPatch(restored.base, restored.draft, { content: "A" }, retrying);
  let retryRequests = 0;
  const retry = await commitNoteDraft(restored.base, restored.draft, async () => {
    retryRequests++;
    return { status: 409, note: server };
  });
  assert.equal(retryRequests, 1);
  assert.equal(retry.note.content, "B");
  assert.deepEqual(retry.conflicts, []); // The shared helper correctly treats A as an old-base no-op.
  const protectedConflicts = uncertainDocumentConflicts(restored.base, restored.draft, retry.note, restored.possible);
  assert.deepEqual(protectedConflicts.map(conflict => conflict.field), ["content"]);
  assert.equal(mergeNoteDraft(retry.note, restored.draft).content, "A");
  // Equivalent to choosing "Keep my draft": advance the confirmed base, retain local A, then CAS.
  const kept = await commitNoteDraft(retry.note, restored.draft, async (patch, version) => {
    assert.equal(version, server.version);
    server = { ...server, ...patch, version: server.version + 1 } as SharedNote;
    return { status: 200, note: server };
  });
  assert.equal(server.content, "A");
  assert.deepEqual(clearSavedNoteDraft(restored.draft, kept.originalPatch), {});
});

test("uncertain guards preserve third-party conflicts without changing genuine no-op behavior", () => {
  const possible = possibleDocumentSave(base, {}, { content: "B" });
  assert.equal(uncertainDocumentConflicts(base, { content: "A" }, { ...base, content: "C", version: 3 }, possible).length, 1);
  assert.deepEqual(uncertainDocumentConflicts(base, { content: "A" }, { ...base, content: "A", version: 3 }, possible), []);
  assert.deepEqual(uncertainDocumentConflicts(base, { content: "A" }, { ...base, content: "B", version: 2 }, {}), []);
  assert.deepEqual(possibleDocumentSave(base, {}, { content: "A" }), {});
});

test("undo while B is being saved remains pending until A is persisted", () => {
  const pending = applyDocumentPatch(base,{content:"B"},{content:"A"},{content:"B"});
  assert.deepEqual(pending,{content:"A"});
  const afterResponse = clearSavedNoteDraft(pending,{content:"B"});
  assert.equal(mergeNoteDraft({...base,content:"B",version:2},afterResponse).content,"A");
  assert.deepEqual(clearSavedNoteDraft(afterResponse,{content:"A"}),{});
});
test("reverting without a save in flight removes a genuine no-op", () => {
  assert.deepEqual(applyDocumentPatch(base,{content:"B"},{content:"A"}),{});
});
test("parallel title and content changes do not clear each other", () => {
  assert.deepEqual(applyDocumentPatch(base,{title:"Renamed",content:"B"},{content:"A"},{title:"Renamed",content:"B"}),{title:"Renamed",content:"A"});
});
