import assert from "node:assert/strict";
import test from "node:test";
import { hasDraggedFiles, registerFileDrop, type FileTransfer } from "../lib/file-drop";

function drag(type: string, transfer: FileTransfer, relatedTarget: EventTarget | null = null) {
  const event = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    relatedTarget: { value: relatedTarget },
  });
  return event;
}

test("OS file drags are detected even when protected files are empty", () => {
  assert.equal(hasDraggedFiles({ types: ["Files"], files: { length: 0 } as FileList }), true);
  assert.equal(hasDraggedFiles({ types: [], items: [{ kind: "file" }] as unknown as DataTransferItemList }), true);
  assert.equal(hasDraggedFiles({ types: [], files: { length: 1 } as FileList }), true);
  assert.equal(hasDraggedFiles({ types: ["application/x-moz-file"] }), true);
  assert.equal(hasDraggedFiles({ types: ["text/plain", "text/uri-list"] }), false);
  assert.equal(hasDraggedFiles(null), false);
});

test("native capture accepts the whole surface and delivers files once", () => {
  const host = new EventTarget();
  const global = new EventTarget();
  const states: boolean[] = [];
  const received: FileList[] = [];
  const files = [new File(["hello"], "hello.txt")] as unknown as FileList;
  const transfer = { types: ["Files"], files, dropEffect: "none" };
  const cleanup = registerFileDrop(host, {
    containsTarget: (target) => target === host,
    onActive: (active) => states.push(active),
    onFiles: (value) => received.push(value),
    resetTarget: global,
  });
  const entering = drag("dragenter", transfer);
  host.dispatchEvent(entering);
  assert.equal(entering.defaultPrevented, true);
  assert.equal(states.at(-1), true);
  const hovering = drag("dragover", transfer);
  host.dispatchEvent(hovering);
  assert.equal(hovering.defaultPrevented, true);
  assert.equal(transfer.dropEffect, "copy");
  host.dispatchEvent(drag("dragleave", transfer, host));
  assert.equal(states.at(-1), true, "moving between children keeps the overlay visible");
  const dropping = drag("drop", transfer);
  host.dispatchEvent(dropping);
  assert.equal(dropping.defaultPrevented, true);
  assert.deepEqual(received, [files]);
  assert.equal(states.at(-1), false);
  cleanup();
  const afterCleanup = drag("drop", transfer);
  host.dispatchEvent(afterCleanup);
  assert.equal(afterCleanup.defaultPrevented, false);
  assert.equal(received.length, 1);
});

test("note-owned drops and internal text drags pass through the chat handler", () => {
  const host = new EventTarget();
  let noteOwned = true;
  let count = 0;
  const cleanup = registerFileDrop(host, {
    accepts: () => !noteOwned,
    containsTarget: () => true,
    onActive: () => {},
    onFiles: () => { count += 1; },
  });
  const transfer = { types: ["Files"], files: [new File(["note"], "note.txt")] as unknown as FileList };
  const noteEvent = drag("drop", transfer);
  host.dispatchEvent(noteEvent);
  assert.equal(noteEvent.defaultPrevented, false);
  assert.equal(count, 0);
  noteOwned = false;
  const textEvent = drag("dragover", { types: ["text/plain"] });
  host.dispatchEvent(textEvent);
  assert.equal(textEvent.defaultPrevented, false);
  host.dispatchEvent(drag("drop", transfer));
  assert.equal(count, 1);
  cleanup();
});

test("leaving the window, Escape and blur clear the drop state", () => {
  const host = new EventTarget();
  const global = new EventTarget();
  let active = false;
  const cleanup = registerFileDrop(host, {
    containsTarget: () => false,
    onActive: (value) => { active = value; },
    onFiles: () => {},
    resetTarget: global,
  });
  const transfer = { types: ["Files"] };
  for (const action of ["leave", "escape", "blur", "dragend"]) {
    host.dispatchEvent(drag("dragover", transfer));
    assert.equal(active, true);
    if (action === "leave") host.dispatchEvent(drag("dragleave", transfer));
    else if (action === "escape") {
      const event = new Event("keydown");
      Object.defineProperty(event, "key", { value: "Escape" });
      global.dispatchEvent(event);
    } else global.dispatchEvent(new Event(action));
    assert.equal(active, false);
  }
  cleanup();
});
