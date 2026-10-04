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

test("composer uses an uncontrolled textarea with an HTML placeholder", () => {
  assert.match(source, /<textarea/);
  assert.match(source, /placeholder=\{placeholder\}/);
  assert.match(source, /defaultValue=\{liveValue\}/);
  assert.match(source, /shouldSyncComposerDom\(element\.value, liveValue, focused, nonceChanged\)/);
  assert.match(source, /if \(!nonceChanged && focused\) return;/);
  assert.match(source, /element\.setSelectionRange\(cursor, cursor\)/);
  assert.match(source, /HTMLTextAreaElement/);
  assert.doesNotMatch(source, /value=\{liveValue\}/);
  assert.doesNotMatch(source, /contentEditable/);
  assert.doesNotMatch(source, /data-composer-placeholder/);
  assert.doesNotMatch(source, /function writeComposerDom/);
  assert.doesNotMatch(source, /element\.innerText/);
  assert.doesNotMatch(cssSource, /content:\s*attr\(data-placeholder\)/);
});

test("composer stays typable after a programmatic send clear", () => {
  assert.match(source, /syncNonce/);
  assert.match(source, /lastSyncNonceRef/);
  assert.match(shellSource, /useRef<HTMLTextAreaElement>\(null\)/);
  assert.match(shellSource, /composerPlainText\(textareaRef\.current/);
  assert.match(shellSource, /element\.setSelectionRange\(cursor, cursor\)/);
  assert.doesNotMatch(shellSource, /textareaRef\.current\?\.innerText/);
  assert.doesNotMatch(shellSource, /createTreeWalker\(element/);
  assert.match(
    shellSource,
    /setInputGuarded\("", "submitted"\);\s*draftInputRef\.current = "";\s*setComposerSyncNonce/,
  );
  assert.match(
    shellSource,
    /setInputGuarded\("", "queued"\);\s*setComposerSyncNonce/,
  );
  assert.match(shellSource, /setInput\(target\.content\);\s*setComposerSyncNonce/);
  assert.match(shellSource, /setInput\(message\.text\);\s*setComposerSyncNonce/);
  assert.match(shellSource, /setInput\(nextInput\);\s*setComposerSyncNonce/);
  assert.match(shellSource, /shouldCommitComposerParentState\(previousValue, value\)/);
  assert.match(shellSource, /COMPOSER_STATE_COMMIT_MS/);
  assert.match(shellSource, /inputCommitTimerRef/);
  const changeHandler = shellSource.slice(
    shellSource.indexOf("function handleComposerInputChange"),
    shellSource.indexOf("function openSlashModelPicker"),
  );
  assert.match(changeHandler, /shouldCommitComposerParentState/);
  assert.doesNotMatch(changeHandler, /startTransition/);
});
