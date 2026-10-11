import assert from "node:assert/strict";
import test from "node:test";
import { flushNoteEditors, registerNoteEditorFlush } from "../lib/note-editor-lifecycle";
test("logout waits for editors and preserves sessions when drafts cannot save", async () => {
  let resolve!: (value: boolean) => void;
  const unregister = registerNoteEditorFlush(() => new Promise<boolean>(done => { resolve = done; }));
  let finished = false;
  const flushing = flushNoteEditors().then(result => { finished = true; return result; });
  await Promise.resolve();
  assert.equal(finished, false);
  resolve(false);
  assert.equal(await flushing, false);
  unregister();
  assert.equal(await flushNoteEditors(), true);
});
test("failed editors do not bypass the save barrier", async () => {
  const unregister = registerNoteEditorFlush(async () => { throw new Error("offline"); });
  assert.equal(await flushNoteEditors(), false);
  unregister();
});
