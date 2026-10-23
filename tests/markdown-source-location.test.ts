import assert from "node:assert/strict";
import test from "node:test";
import { resolveMarkdownSourceLocation } from "../lib/markdown-source-location";

test("Markdown source positions clamp columns and select complete requested line ranges", () => {
  const value = "# Title\nsecond line\nend";
  assert.deepEqual(resolveMarkdownSourceLocation(value, { path: "n.md", line: 2, column: 3, endLine: 3 }), {
    from: 10, to: value.length, changes: [],
  });
  assert.deepEqual(resolveMarkdownSourceLocation(value, { path: "n.md", line: 999, column: 999 }), {
    from: value.length, to: value.length, changes: [],
  });
});

test("source offsets retain CRLF and emoji UTF-16 positions without including carriage returns in selections", () => {
  const value = "# 📝\r\nabc\r\nend";
  const result = resolveMarkdownSourceLocation(value, { path: "n.md", line: 2, column: 2, endLine: 2, endColumn: 999 });
  assert.equal(value.slice(result.from, result.to), "bc");
});

test("changed-line links relocate uniquely after inserted text", () => {
  const value = "intro\r\n# Title\r\nnew\r\ntext here\r\nend";
  const result = resolveMarkdownSourceLocation(value, {
    path: "n.md", line: 2, changes: [{ startLine: 2, endLine: 3, kind: "added", text: "new\ntext here" }],
  });
  assert.equal(value.slice(result.from, result.to), "new\r\ntext here");
  assert.deepEqual(result.changes, [{ from: result.from, to: result.to, kind: "added" }]);
});

test("ambiguous stale snippets leave the explicit source position intact", () => {
  const result = resolveMarkdownSourceLocation("same\nother\nsame", {
    path: "n.md", line: 2, column: 2, changes: [{ startLine: 2, endLine: 2, kind: "added", text: "same" }],
  });
  assert.deepEqual(result, { from: 6, to: 6, changes: [] });
});

test("deletion markers clamp to surviving source and empty files remain navigable", () => {
  assert.deepEqual(resolveMarkdownSourceLocation("", {
    path: "n.md", line: 1, changes: [{ startLine: 50, endLine: 51, kind: "deleted" }],
  }), { from: 0, to: 0, changes: [{ from: 0, to: 0, kind: "deleted" }] });
});

test("matching recorded snippets retain their original range even when repeated elsewhere", () => {
  const result = resolveMarkdownSourceLocation("same\nother\nsame", {
    path: "n.md", changes: [{ startLine: 3, endLine: 3, kind: "added", text: "same" }],
  });
  assert.deepEqual(result.changes, [{ from: 11, to: 15, kind: "added" }]);
});
