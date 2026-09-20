import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/rich-composer-input.tsx", import.meta.url),
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
