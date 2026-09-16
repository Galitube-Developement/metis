import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stripReadFileLinePrefixes } from "../lib/remote-file-content";

const editor = readFileSync(
  new URL("../components/remote-file-editor.tsx", import.meta.url),
  "utf8",
);

test("remote file content drops only gateway line prefixes and preserves indentation", () => {
  const gatewayOutput = [
    "     1\tfunction example() {",
    "     2\t\treturn true;",
    "     3\t  return false;",
    "     4\t}",
    "",
  ].join("\n");

  assert.equal(
    stripReadFileLinePrefixes(gatewayOutput),
    "function example() {\n\treturn true;\n  return false;\n}\n",
  );
});

test("remote file content is unchanged when it has no sequential gateway prefixes", () => {
  const content = "1. first item\n2. second item\n";
  assert.equal(stripReadFileLinePrefixes(content), content);
});

test("remote file editor inserts tab characters instead of spaces", () => {
  assert.match(editor, /detectIndentation: false/);
  assert.match(editor, /insertSpaces: false/);
  assert.match(editor, /lineNumbers: "on"/);
});

test("remote file editor uses app dialogs for folder creation and renaming", () => {
  assert.doesNotMatch(editor, /window\.prompt/);
  assert.match(editor, /entryDialogMode/);
  assert.match(editor, /<DialogTitle>\{entryDialogMode === "rename" \? "Rename entry" : "Create folder"\}<\/DialogTitle>/);
  assert.match(editor, /<form onSubmit=\{submitEntryDialog\}/);
});
