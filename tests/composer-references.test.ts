import assert from "node:assert/strict";
import test from "node:test";
import {
  composerMentionQuery, composerMentionTokens, replaceComposerMention,
  composerIsComposing, composerReferenceKeyAction,
} from "../lib/composer-references";

test("queries use real @ boundaries and UTF-16 caret offsets", () => {
  const text = "😀 **bold**\n(@Straße";
  const start = text.indexOf("@");
  assert.deepEqual(composerMentionQuery(text, text.length), { start, end: text.length, query: "Straße" });
  assert.equal(composerMentionQuery("mail@example.com", 16), null);
  assert.equal(composerMentionQuery("https://host/@file", 18), null);
  assert.equal(composerMentionQuery("@one\nnext", 9), null);
  assert.equal(composerMentionQuery("@one", 2, 4), null);
  assert.equal(composerMentionQuery("@one", -1), null);
  assert.equal(composerMentionQuery("@one", 99), null);
  assert.equal(composerMentionQuery("@one", 1.5), null);
  assert.equal(composerMentionQuery("@one", 0), null);
});

test("selected tokens match complete @labels, longest first, never plain words or emails", () => {
  const text = "Road map @Road map, @Road @Roadmap mail@Road @Road map\n";
  const tokens = composerMentionTokens(text, ["Road", "Road map", "Road map"]);
  assert.deepEqual(tokens.map(({ label }) => label), ["Road map", "Road", "Road map"]);
  for (const token of tokens) assert.equal(text.slice(token.start, token.end), "@" + token.label);
  assert.equal(composerMentionQuery("@Road map", 9, 9, ["Road map"]), null);
  assert.equal(composerMentionQuery("@Road map", 4, 4, ["Road map"]), null);
  assert.deepEqual(composerMentionQuery("@Road map @new", 14, 14, ["Road map"]), { start: 10, end: 14, query: "new" });
  assert.equal(composerMentionTokens("@file.tsx @file.ts", ["file.ts"]).length, 1);
});

test("replacement preserves rich text, newlines, existing mentions and suffix; caret stays local", () => {
  const text = "**bold**\n@old\nUse @ne\n_tail_";
  const start = text.indexOf("@ne");
  const result = replaceComposerMention(text, { start, end: start + 3, query: "ne" }, "New note");
  assert.deepEqual(result, { value: "**bold**\n@old\nUse @New note\n_tail_", cursor: start + 9 });
  assert.deepEqual(replaceComposerMention("@ne", { start: 0, end: 3, query: "ne" }, "New"), { value: "@New ", cursor: 5 });
  assert.deepEqual(replaceComposerMention("@ne rest", { start: 0, end: 3, query: "ne" }, "New"), { value: "@New rest", cursor: 4 });
  assert.deepEqual(replaceComposerMention("@ne!", { start: 0, end: 3, query: "ne" }, "New"), { value: "@New!", cursor: 4 });
});

test("stale or invalid replacement never damages a newer draft", () => {
  const mention = { start: 0, end: 3, query: "ne" };
  assert.equal(replaceComposerMention("new draft", mention, "New"), null);
  assert.equal(replaceComposerMention("@no", mention, "New"), null);
  assert.equal(replaceComposerMention("@ne", { ...mention, start: -1 }, "New"), null);
  assert.equal(replaceComposerMention("@ne", { ...mention, end: 99 }, "New"), null);
  assert.equal(replaceComposerMention("@ne", mention, "Bad\nlabel"), null);
  assert.equal(replaceComposerMention("@ne", mention, ""), null);
});

test("IME is protected by native composition, lifecycle state and legacy keyCode", () => {
  assert.equal(composerIsComposing({ isComposing: true }), true);
  assert.equal(composerIsComposing({ keyCode: 229 }), true);
  assert.equal(composerIsComposing({}, true), true);
  assert.equal(composerIsComposing({ isComposing: false, keyCode: 13 }), false);
});

test("keyboard navigation wraps categories/results and clamps an outdated index", () => {
  const action = (key: string, index = 0, count = 3, extra = {}) =>
    composerReferenceKeyAction({ key, index, count, ...extra });
  assert.deepEqual(action("ArrowUp"), { type: "move", index: 2 });
  assert.deepEqual(action("ArrowDown", 2), { type: "move", index: 0 });
  assert.deepEqual(action("Enter", 9), { type: "select", index: 2 });
  assert.deepEqual(action("Tab"), { type: "select", index: 0 });
  assert.equal(action("Enter", 0, 3, { shiftKey: true }), null);
  assert.equal(action("Tab", 0, 3, { shiftKey: true }), null);
  assert.equal(action("Enter", 0, 3, { repeat: true }), null);
  assert.equal(action("Enter", 0, 3, { composing: true }), null);
  assert.equal(action("ArrowDown", 0, 0), null);
  assert.equal(action("Enter", 0, 0), null);
  assert.deepEqual(action("Escape", 0, 0), { type: "dismiss" });
});
