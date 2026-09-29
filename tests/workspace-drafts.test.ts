import assert from "node:assert/strict";
import test from "node:test";
import { mergeIncomingWorkspace, remainingWorkspaceDraft } from "../lib/workspace-drafts";

const server = { id: "plan-1", name: "Plan", content: "saved", version: 3 };

test("server refresh keeps a newer unsaved Markdown draft", () => {
  const local = { ...server, content: "saved plus new text" };
  assert.deepEqual(
    mergeIncomingWorkspace(server, local, { content: local.content }),
    local,
  );
});

test("older server snapshots cannot replace a newer saved workspace", () => {
  const local = { ...server, content: "latest", version: 4 };
  assert.deepEqual(mergeIncomingWorkspace(server, local), local);
});

test("save acknowledgment clears only fields included in that request", () => {
  assert.deepEqual(
    remainingWorkspaceDraft({ name: "Plan", content: "newer text" }, server),
    { content: "newer text" },
  );
  assert.equal(remainingWorkspaceDraft({ content: "saved" }, server), undefined);
});
