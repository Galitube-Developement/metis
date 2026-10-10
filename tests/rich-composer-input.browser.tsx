/** Isolated browser fixture: bundle with esbuild and open through Metis browser tools.
 * No app APIs, storage, provider fixtures or real user data are used.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { RichComposerInput, composerPlainText } from "../components/rich-composer-input";
import type { ComposerMentionQuery } from "../lib/composer-references";

const results: string[] = [];
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  results.push("PASS " + message);
}
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const editorRef = React.createRef<HTMLTextAreaElement>();
const changes: string[] = [];
const keys: string[] = [];
const queries: Array<ComposerMentionQuery | null> = [];
const selections: Array<[number, number]> = [];
function render(value: string, syncNonce = 0) {
  flushSync(() => root.render(
    <RichComposerInput ref={editorRef} value={value} syncNonce={syncNonce}
      mentionLabels={["Old note"]} placeholder="Message Metis…" aria-label="Fixture composer"
      onChange={(value) => changes.push(value)}
      onKeyDown={(event) => keys.push(event.key)}
      onMentionQueryChange={(query) => queries.push(query)}
      onSelectionChange={(_, start, end) => selections.push([start, end])} />,
  ));
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
async function run() {
  const initial = "**bold**\n@Old note\n@new";
  render(initial);
  const editor = editorRef.current!;
  editor.focus();
  editor.setSelectionRange(initial.length, initial.length);
  document.dispatchEvent(new Event("selectionchange"));
  await settle();
  check(editor.value === initial, "markdown and line breaks survive mount");
  check(queries.at(-1)?.query === "new", "caret-only selection reports active @query");
  check(changes.length === 0, "caret-only movement does not mutate the draft");

  editor.setSelectionRange(initial.indexOf("@Old") + 3, initial.indexOf("@Old") + 3);
  document.dispatchEvent(new Event("selectionchange"));
  await settle();
  check(queries.at(-1) === null, "selected complete @token does not reopen autocomplete");
  const selectedStart = initial.indexOf("@new");
  editor.setSelectionRange(selectedStart, initial.length);
  document.dispatchEvent(new Event("selectionchange"));
  await settle();
  check(queries.at(-1) === null && selections.at(-1)?.[0] === selectedStart,
    "non-collapsed selection closes autocomplete");

  editor.setSelectionRange(2, 2);
  render("stale parent");
  check(editor.value === initial && editor.selectionStart === 2,
    "focused editor rejects stale state without moving the caret");

  editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", isComposing: true }));
  editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  check(keys.length === 0, "IME confirmation and navigation never reach picker handlers");
  render("forced replacement", 1);
  check(editor.value === initial, "forced sync waits until IME composition finishes");
  editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "語" }));
  await settle();
  check(changes.at(-1) === initial, "composition end commits the full live draft");
  check(editor.value === "forced replacement", "deferred sync nonce applies after composition end");
  editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  check(keys.at(-1) === "ArrowDown", "normal keyboard navigation resumes after IME");

  render("", 2);
  check(editor.value === "" && document.activeElement === editor && editor.selectionStart === 0,
    "send clear preserves editor focus and caret");
  render("Message Metis…", 3);
  check(editor.value === "Message Metis…" && composerPlainText(editor) === editor.value,
    "literal placeholder text is a valid message");
  render("a\u00a0b\n**bold**", 4);
  check(composerPlainText(editor) === "a\u00a0b\n**bold**", "native text preserves NBSP and rich-text source");
  check(host.querySelector("textarea") === editor, "editor remains mounted across all transitions");
}
void run().then(async () => {
  const output = results.join("\n") + "\nBROWSER_COMPOSER_PASS " + results.length;
  document.body.append(Object.assign(document.createElement("pre"), { textContent: output }));
  await fetch("/result", { method: "POST", body: output });
}).catch(async (error: unknown) => {
  const output = results.join("\n") + "\nBROWSER_COMPOSER_FAIL " + String(error);
  document.body.append(Object.assign(document.createElement("pre"), { textContent: output }));
  await fetch("/result", { method: "POST", body: output });
});
