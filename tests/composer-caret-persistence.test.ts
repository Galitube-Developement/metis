import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/rich-composer-input.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../components/app-shell.tsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("rich composer preserves its selection across tab visibility changes", () => {
  assert.match(source, /document\.addEventListener\("selectionchange", handleSelectionChange\)/);
  assert.match(source, /selectionRef\.current = \{ \.\.\.offsets, text \}/);
  assert.match(source, /onBlur=\{\(event\) => \{[\s\S]*captureSelection\(\);[\s\S]*formatText\(element, mentionLabels\)/);
  assert.match(source, /onFocus=\{\(event\) => \{[\s\S]*restoreSelection\(element, saved\)/);
  assert.match(source, /syncNonce/);
  assert.match(source, /shouldSyncComposerDom\(current, value, document\.activeElement === element, force\)/);
});

test("rich composer stays typable after a programmatic send clear", () => {
  assert.match(source, /function writeComposerDom/);
  assert.match(source, /element\.replaceChildren\(document\.createElement\("br"\)\)/);
  assert.match(source, /if \(force \|\| !value\)/);
  assert.match(source, /placeComposerCaret\(element, value\.length\)/);
  assert.match(source, /onMouseDown=/);
  assert.match(cssSource, /\.rich-composer-input\[data-empty\]::before/);
  assert.match(cssSource, /pointer-events:\s*none/);
  assert.match(
    shellSource,
    /setInputGuarded\("", "submitted"\);\s*draftInputRef\.current = "";\s*setComposerSyncNonce/,
  );
  assert.match(
    shellSource,
    /setInputGuarded\("", "queued"\);\s*setComposerSyncNonce/,
  );
});
