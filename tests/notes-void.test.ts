import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const notes = readFileSync(new URL("../components/notes-void.tsx", import.meta.url), "utf8");
const pinned = readFileSync(new URL("../components/pinned-notes-panel.tsx", import.meta.url), "utf8");

test("empty note body can start a move without blocking text clicks", () => {
  assert.match(notes, /const fromEditorEmpty = Boolean\(target\.closest\("\.editable-markdown"\)\) && !fromContent/);
  assert.match(notes, /if \(fromEditorEmpty\) \{\s*setDrag\(\{[\s\S]*?mode: "move",\s*armed: true/);

  const contentGuard = /const fromContent = Boolean\(target\.closest\("([^"]+)"\)\)/.exec(notes);
  const editorGuard = /if \(target\.closest\("([^"]+)"\)\) \{\s*event\.stopPropagation\(\);/.exec(notes);
  const pinnedGuard = /if \(target\.closest\("([^"]+)"\)\) return;\s*startDrag\(event, note\);/.exec(pinned);
  for (const [name, guard] of [["note content", contentGuard], ["note editor", editorGuard], ["pinned note", pinnedGuard]] as const) {
    assert.ok(guard, `${name} must guard interactive targets before dragging`);
    const selectors = new Set(guard[1].split(",").map((selector) => selector.trim()));
    for (const selector of [".markdown-body", ".cm-editor", ".notes-block-editor", "[contenteditable]", "input", "textarea", "button", "a", "[data-editor-control]"]) {
      assert.ok(selectors.has(selector), `${name} must exclude ${selector} from note dragging`);
    }
    assert.equal(selectors.has(".editable-markdown"), false, `${name} must leave empty editor padding draggable`);
  }
});

test("every note can add todos from a header popover beside the palette control", () => {
  assert.match(notes, /aria-label="Add todo"/);
  assert.match(notes, /setDraftTodoNoteId\(\(current\) => current === note\.id \? null : note\.id\)/);
  assert.match(notes, /ref=\{todoInputRef\}/);
  assert.match(notes, /todoInputRef\.current\?\.select\(\)/);
  assert.match(notes, /bg-popover/);
  assert.match(notes, /aria-label="Add todo"[\s\S]*?aria-label="Change note color"/);
  assert.doesNotMatch(notes, /note\.kind === "project" \? \(\s*<div/);
  assert.match(notes, /commitTodos\(note, \[/);
});

test("notes void restores pan and wheel interaction after returning to the tab", () => {
  assert.match(notes, /setDrag\(null\);/);
  assert.match(notes, /document\.addEventListener\("visibilitychange", resetSurfaceInteraction\)/);
  assert.match(notes, /window\.addEventListener\("pageshow", resetSurfaceInteraction\)/);
  assert.match(notes, /surface\.removeEventListener\("wheel", handleWheel, wheelOptions\)/);
  assert.match(notes, /id: "__pan__"/);
  assert.doesNotMatch(notes, /compact && "pointer-events-none"\);/);
});

test("shared notes pinches with two fingers around the midpoint", () => {
  assert.match(notes, /handlePinchStart/);
  assert.match(notes, /pinchDistance\(event\.touches\[0\], event\.touches\[1\]\)/);
  assert.match(notes, /pinchMidpoint/);
  assert.match(notes, /insideEditor\(event\.target\)/);
});

test("loading and empty overlays do not capture pan or wheel on the notes surface", () => {
  assert.match(notes, /status === "loading" \? \(\s*<div className="pointer-events-none absolute inset-0/);
  assert.match(notes, /!visibleNotes\.length \? \(\s*<div className="pointer-events-none absolute inset-0/);
  assert.match(notes, /id: "__pan__"/);
});

test("note saves keep confirmed base separate and expose field-wise conflicts", async () => {
  const source = readFileSync(new URL("../lib/note-save-state.ts", import.meta.url), "utf8");
  assert.match(source, /enqueueNoteSave/);
  assert.match(source, /noteConflictFields/);
  assert.match(notes, /confirmedNotesRef/);
  assert.match(notes, /Keep local/);
  assert.match(notes, /Use server/);
});
