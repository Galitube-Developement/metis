import assert from "node:assert/strict";
import test from "node:test";
import { isMarkdownFile } from "../lib/markdown-file";
import { effectiveFileMime, fileViewKind } from "../lib/file-types";

test("Markdown file identity accepts case-insensitive extensions and explicit MIME parameters", () => {
  for (const [path, mime] of [
    ["/project/README.md", ""],
    ["C:\\work\\SKILL.MD", "application/octet-stream"],
    ["notes.markdown?download=1#heading", ""],
    ["attachment", "Text/Markdown; charset=utf-8"],
  ]) assert.equal(isMarkdownFile(path, mime), true, path);
});

test(".markdown attachments remain text when the upload has a generic MIME type", () => {
  assert.equal(effectiveFileMime("application/octet-stream", "README.markdown"), "text/markdown");
  assert.equal(fileViewKind("application/octet-stream", "README.markdown"), "text");
});

test("Markdown-looking content and unrelated files do not select the rich editor", () => {
  for (const path of ["package.json", "README.txt", "code.ts", "README.md.bak", "markdown", "notes.mdx"]) {
    assert.equal(isMarkdownFile(path), false, path);
  }
  assert.equal(isMarkdownFile("file", "text/plain"), false);
});
