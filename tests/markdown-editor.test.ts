import assert from "node:assert/strict";
import test from "node:test";
import { minimalMarkdownChange, replaceEmbeddedSource, toggleMarkdownTask } from "../lib/markdown-editor";

const fence = String.fromCharCode(96).repeat(3);

test("external Markdown updates touch only the changed span", () => {
  assert.deepEqual(minimalMarkdownChange("## Heading\nabc", "## Heading\nabXc"), {
    from: 13,
    to: 13,
    insert: "X",
  });
  assert.deepEqual(minimalMarkdownChange("hello world", "hello there"), {
    from: 6,
    to: 11,
    insert: "there",
  });
  assert.equal(minimalMarkdownChange("same", "same"), null);
});

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
