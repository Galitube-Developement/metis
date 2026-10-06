import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const userText = readFileSync(new URL("../components/rich-user-text.tsx", import.meta.url), "utf8");
const markdown = readFileSync(new URL("../components/markdown.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/editable-markdown.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const subagentView = readFileSync(new URL("../components/subagent-chat-view.tsx", import.meta.url), "utf8");

test("user messages render markdown links instead of visible brackets", () => {
  assert.match(userText, /parseRichUserText/);
  assert.match(userText, /ai-chat:open-workspace/);
  assert.match(userText, /ai-chat:open-note/);
  assert.match(userText, /ai-chat:open-automations/);
  assert.match(userText, /part\.label/);
});

test("markdown renders chart fences with ChartBoard before graph fences", () => {
  assert.match(markdown, /isChartSource/);
  assert.match(markdown, /<ChartBoard code=\{code\}/);
  assert.ok(markdown.indexOf("isChartSource") < markdown.indexOf("isGraphSource"));
});

test("markdown renders graph fences with GraphBoard", () => {
  assert.match(markdown, /isGraphSource/);
  assert.match(markdown, /<GraphBoard code=\{code\}/);
  assert.match(markdown, /pre: \(\{ children \}/);
});

test("editable markdown writes in one styled surface and keeps an optional preview", () => {
  assert.match(editor, /new EditorView/);
  assert.match(editor, /markdownStyling/);
  assert.match(editor, /className="editable-markdown-editor"/);
  assert.match(editor, /setPreview/);
  assert.match(editor, /<Markdown content=\{embedFileLinks\(previewDraft\)\}/);
  assert.doesNotMatch(editor, /<textarea/);
});

test("new chat from shared notes does not reopen the notes route", () => {
  assert.match(shell, /suppressNotesRouteRef/);
  assert.match(shell, /setFocusedNoteId\(null\)/);
  assert.match(shell, /if \(suppressNotesRouteRef\.current\) return;/);
});

test("subagent chat shows the loading chat state until the first fetch", () => {
  assert.match(subagentView, /aria-label="Loading chat"/);
  assert.match(subagentView, /Loading chat…/);
  assert.match(subagentView, /setReady\(false\)/);
});

test("text deltas yield to the UI thread", () => {
  assert.match(shell, /startTransition\(\(\) => \{/);
});
