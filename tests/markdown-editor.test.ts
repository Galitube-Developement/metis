import assert from "node:assert/strict";
import test from "node:test";
import { replaceEmbeddedSource, toggleMarkdownTask } from "../lib/markdown-editor";

const fence = String.fromCharCode(96).repeat(3);

test("task checkbox edits the matching source line and leaves fenced examples alone", () => {
  const source = ["- [ ] first", fence + "md", "- [ ] example", fence, "1. [x] second"].join("\n");
  assert.equal(
    toggleMarkdownTask(source, 1, false),
    ["- [ ] first", fence + "md", "- [ ] example", fence, "1. [ ] second"].join("\n"),
  );
  assert.equal(toggleMarkdownTask(source, 0, true).split("\n")[0], "- [x] first");
});

test("board edits replace only the selected Markdown fence", () => {
  const source = [
    "# Plan",
    fence + "chart",
    '{"title":"First"}',
    fence,
    fence + "graph",
    '{"title":"Graph"}',
    fence,
    fence + "chart",
    '{"title":"Second"}',
    fence,
  ].join("\n");
  const updated = replaceEmbeddedSource(source, "chart", 1, '{"title":"Updated"}');
  assert.equal(updated, source.replace('{"title":"Second"}', '{"title":"Updated"}'));
  assert.equal(replaceEmbeddedSource(source, "chart", 5, "unused"), source);
});
