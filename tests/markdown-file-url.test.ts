import assert from "node:assert/strict";
import test from "node:test";
import { markdownFileDisplayUrl } from "../lib/markdown-file-url";
import { parseWorkspaceFileLink } from "../lib/workspace-file-link";

test("relative Markdown images resolve against the selected file instead of the app URL", () => {
  const source = "../assets/Design image.png";
  const displayed = markdownFileDisplayUrl(source, "/work/docs/README.md", "image");
  const url = new URL(displayed, "https://metis.invalid");
  assert.equal(url.pathname, "/api/remote/preview");
  assert.equal(url.searchParams.get("path"), "/work/assets/Design image.png");
  assert.equal(source, "../assets/Design image.png");
});

test("relative document links open the matching workspace file and retain line coordinates", () => {
  const href = markdownFileDisplayUrl("./nested/Plan.markdown#L12C4", "/work/docs/README.md", "link");
  assert.deepEqual(parseWorkspaceFileLink(href), { path: "/work/docs/nested/Plan.markdown", line: 12, column: 4 });
});

test("absolute server file links and encoded characters retain file identity", () => {
  assert.deepEqual(parseWorkspaceFileLink(markdownFileDisplayUrl("/work/Gr%C3%B6%C3%9Fe.md", "/work/readme.md", "link")), {
    path: "/work/Größe.md",
  });
});

test("external, internal, attachment and same-page links retain their original behavior", () => {
  for (const source of ["https://example.com/docs", "#heading", "note://id", "issue://id", "metis://note/id", "/api/notes/id/attachments/img", "//cdn.example.com/x.png"]) {
    assert.equal(markdownFileDisplayUrl(source, "/work/readme.md", "link"), source);
    assert.equal(markdownFileDisplayUrl(source, "/work/readme.md", "image"), source);
  }
});

test("invalid escaped paths cannot produce unsafe workspace navigation", () => {
  assert.equal(markdownFileDisplayUrl("%00bad.md", "/work/readme.md", "link"), "");
  assert.equal(markdownFileDisplayUrl("%XX", "/work/readme.md", "image"), "");
});
