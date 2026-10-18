import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerEditedFiles, EditedFiles } from "../components/edited-files";
import { editedFilesForMessage } from "../lib/edited-files";
import type { ToolPart } from "../lib/store";

Object.assign(globalThis, { React });

const tool: ToolPart = {
  id: "first", name: "edit_file", status: "completed",
  editedFile: {path: "/workspace/src/main.ts", target: "server", additions: 2, deletions: 1},
};

test("composer files appear during a run and remain after it completes", () => {
  const message = { streaming: true, tools: [tool, {...tool, id: "pending", status: "running", editedFile: undefined}] };
  const live = renderToStaticMarkup(<ComposerEditedFiles files={editedFilesForMessage(message)} />);
  assert.match(live, /1 file edited/);
  assert.match(live, /aria-haspopup="dialog"/);
  const completedMessage = {...message, streaming: false};
  const completed = renderToStaticMarkup(<ComposerEditedFiles files={editedFilesForMessage(completedMessage)} />);
  assert.match(completed, /1 file edited/);
});

test("live count includes new successful files while repeated edits stay one row", () => {
  const files = editedFilesForMessage({tools: [
    tool,
    {...tool, id: "again"},
    {...tool, id: "second", editedFile: {path: "/workspace/src/other.ts", target: "server"}},
    {...tool, id: "failed", status: "error"},
  ]});
  const html = renderToStaticMarkup(<ComposerEditedFiles files={files} />);
  assert.match(html, /2 files edited/);
});

test("no edits leave the composer clear, while historical file summaries remain available", () => {
  assert.equal(renderToStaticMarkup(<ComposerEditedFiles files={[]} />), "");
  const files = editedFilesForMessage({tools: [tool]});
  assert.equal(renderToStaticMarkup(<EditedFiles files={files} streaming />), "");
  const history = renderToStaticMarkup(<EditedFiles files={files} />);
  assert.match(history, /Open \/workspace\/src\/main.ts/);
  assert.match(history, /2 lines added/);
});
