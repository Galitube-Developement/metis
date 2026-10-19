import assert from "node:assert/strict";
import test from "node:test";
import { internalLinkNavigation, parseInternalLink } from "../lib/internal-link";

test("internal links resolve encoded IDs and ignore optional locations", () => {
  assert.deepEqual(parseInternalLink("workspace://plan/plan-1?view=tasks"), { kind: "plan", id: "plan-1" });
  assert.deepEqual(parseInternalLink("WORKSPACE://CANVAS/canvas-default#section"), { kind: "canvas", id: "canvas-default" });
  assert.deepEqual(parseInternalLink("note://weekly%20ideas"), { kind: "note", id: "weekly ideas" });
  assert.deepEqual(parseInternalLink("automation://daily"), { kind: "automation", id: "daily" });
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
});
