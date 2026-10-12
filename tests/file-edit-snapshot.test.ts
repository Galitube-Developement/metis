import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import fs from "node:fs";
import { executeFileEdit } from "../remote-client/file-edit.mjs";
import path from "node:path";
import test from "node:test";
import { withLocalFileEditSnapshot } from "../lib/file-edit-snapshot";
import { revertEditTool } from "../lib/revert";
import type { ToolPart } from "../lib/store";

function tool(
  id: string,
  name: string,
  status: string,
  filePath: string,
  extra: Partial<ToolPart> = {},
): ToolPart {
  return {
    id,
    name,
    status,
    kind: "edit",
    path: filePath,
    input: JSON.stringify({ path: filePath, content: "new content" }),
    ...extra,
  };
}

test("provider write_file snapshot lets Revert delete a newly created file", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-revert-create-"));
  try {
    const filePath = path.join(root, "created.txt");
    const running = withLocalFileEditSnapshot(tool("write-1", "write_file", "running", filePath), undefined, root);
    writeFileSync(filePath, "new content", "utf8");
    const completed = withLocalFileEditSnapshot(
      tool("write-1", "write_file", "completed", filePath, { input: undefined }),
      running,
      root,
    );

    assert.deepEqual(completed.diff, { before: undefined, after: "new content" });
    assert.equal(revertEditTool(completed, root).status, "reverted");
    assert.equal(existsSync(filePath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("provider edit_file snapshot lets Revert restore existing content", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-revert-edit-"));
  try {
    const filePath = path.join(root, "edited.txt");
    writeFileSync(filePath, "before", "utf8");
    const running = withLocalFileEditSnapshot(
      tool("edit-1", "edit_file", "running", filePath, {
        input: JSON.stringify({ path: filePath, oldText: "before", newText: "after" }),
      }),
      undefined,
      root,
    );
    writeFileSync(filePath, "after", "utf8");
    const completed = withLocalFileEditSnapshot(
      tool("edit-1", "edit_file", "completed", filePath, { input: undefined }),
      running,
      root,
    );

    assert.deepEqual(completed.diff, { before: "before", after: "after" });
    assert.equal(revertEditTool(completed, root).status, "reverted");
    assert.equal(readFileSync(filePath, "utf8"), "before");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a batch edit produces one snapshot and Revert restores the entire original", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-revert-batch-"));
  try {
    const filePath = path.join(root, "batch.txt");
    writeFileSync(filePath, "one\ntwo", "utf8");
    const input = { path: filePath, edits: [{ oldText: "one", newText: "first" }, { oldText: "two", newText: "second" }] };
    const running = withLocalFileEditSnapshot(tool("batch-1", "edit_file", "running", filePath, { input: JSON.stringify(input) }), undefined, root);
    executeFileEdit(fs, input);
    const completed = withLocalFileEditSnapshot(tool("batch-1", "edit_file", "completed", filePath, { input: undefined }), running, root);
    assert.deepEqual(completed.diff, { before: "one\ntwo", after: "first\nsecond" });
    assert.equal(revertEditTool(completed, root).status, "reverted");
    assert.equal(readFileSync(filePath, "utf8"), "one\ntwo");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("remote client file tools are not snapshotted against the server workspace", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-revert-remote-"));
  try {
    const filePath = path.join(root, "same-name.txt");
    writeFileSync(filePath, "server content", "utf8");
    const original = tool("write-2", "write_file", "running", filePath, {
      input: JSON.stringify({ target: "client:laptop", path: filePath, content: "remote content" }),
    });
    assert.equal(withLocalFileEditSnapshot(original, undefined, root), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
