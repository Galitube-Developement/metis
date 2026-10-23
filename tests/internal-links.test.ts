import assert from "node:assert/strict";
import test from "node:test";
import { internalLinkNavigation, parseInternalLink } from "../lib/internal-link";

test("internal links resolve encoded IDs and ignore optional locations", () => {
  assert.deepEqual(parseInternalLink("workspace://plan/plan-1?view=tasks"), { kind: "plan", id: "plan-1" });
  assert.deepEqual(parseInternalLink("WORKSPACE://CANVAS/canvas-default#section"), { kind: "canvas", id: "canvas-default" });
  assert.deepEqual(parseInternalLink("note://weekly%20ideas"), { kind: "note", id: "weekly ideas" });
  assert.deepEqual(parseInternalLink("automation://daily"), { kind: "automation", id: "daily" });
  assert.deepEqual(parseInternalLink("issue://task-1"), { kind: "issue", id: "task-1" });
  assert.equal(parseInternalLink("issue://task%2F1"), null);
  assert.deepEqual(parseInternalLink("metis://note/weekly%20ideas"), { kind: "note", id: "weekly ideas" });
  assert.deepEqual(parseInternalLink("workspace://note/n1"), { kind: "note", id: "n1" });
  assert.equal(parseInternalLink("metis://note/%E0%A4%A"), null);
  assert.equal(parseInternalLink("metis://note/a%2Fb"), null);
});

test("note block locations survive parsing and navigation", () => {
  const target = parseInternalLink("metis://note/n1#block-block_123");
  assert.deepEqual(target, {kind:"note",id:"n1",blockId:"block_123"});
  assert.deepEqual(internalLinkNavigation(target!), {href:"#note-n1/block-block_123",event:"ai-chat:open-note",detail:{id:"n1",blockId:"block_123"}});
  assert.deepEqual(parseInternalLink("issue://i1#block-x"), {kind:"issue",id:"i1"});
  assert.deepEqual(parseInternalLink("note://n1#block-x%22"), {kind:"note",id:"n1"});
});

test("unsupported and malformed targets cannot trigger previews", () => {
  for (const href of [undefined, "", "https://example.com/note/one", "workspace://file/%2Ftmp%2Fone",
    "note://", "note://%E0%A4%A", "note://%00", "note://a%2Fb", "automation://a/b", "workspace://plan/a%5Cb"]) {
    assert.equal(parseInternalLink(href), null, href);
  }
});

test("preview links keep their original workspace navigation contracts", () => {
  assert.deepEqual(internalLinkNavigation({ kind: "plan", id: "release" }), {
    href: "#workspace-release", event: "ai-chat:open-workspace", detail: { type: "plan", id: "release" },
  });
  assert.deepEqual(internalLinkNavigation({ kind: "canvas", id: "canvas-default" }).detail, { type: "canvas", id: "canvas-default" });
  assert.equal(internalLinkNavigation({ kind: "note", id: "n1" }).event, "ai-chat:open-note");
  assert.equal(internalLinkNavigation({ kind: "automation", id: "a1" }).event, "ai-chat:open-automations");
  assert.equal(internalLinkNavigation({ kind: "issue", id: "i1" }).event, "ai-chat:open-issue");
});
