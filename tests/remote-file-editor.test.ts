import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stripReadFileLinePrefixes } from "../lib/remote-file-content";
import { subscribeVisiblePolling } from "../lib/visible-polling";

const editor = readFileSync(
  new URL("../components/remote-file-editor.tsx", import.meta.url),
  "utf8",
);

function pollingFixture() {
  const windowEvents = new EventTarget(), documentEvents = new EventTarget();
  let tick: (() => void) | undefined;
  const environment = {
    window: {
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
      setInterval: ((callback: () => void) => { tick = callback; return 1; }) as Window["setInterval"],
      clearInterval: () => { tick = undefined; },
    },
    document: {
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
      visibilityState: "visible" as DocumentVisibilityState,
    },
  };
  return { environment, tick: () => tick?.(), focus: () => windowEvents.dispatchEvent(new Event("focus")),
    visibility: (value: DocumentVisibilityState) => { environment.document.visibilityState = value; documentEvents.dispatchEvent(new Event("visibilitychange")); } };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("filesystem polling avoids overlap, pauses hidden tabs and refreshes on return", async () => {
  const fixture = pollingFixture();
  const signals: AbortSignal[] = [];
  let finish: (() => void) | undefined;
  const stop = subscribeVisiblePolling(signal => { signals.push(signal); return new Promise<void>(resolve => { finish = resolve; }); }, 2000, fixture.environment);
  fixture.tick(); fixture.focus(); await settle();
  assert.equal(signals.length, 1);
  fixture.tick(); await settle(); assert.equal(signals.length, 1);
  finish!(); await settle();
  fixture.visibility("hidden"); fixture.tick(); fixture.focus(); await settle();
  assert.equal(signals.length, 1);
  fixture.visibility("visible"); await settle(); assert.equal(signals.length, 2);
  stop(); assert.equal(signals[1].aborted, true);
  finish!(); await settle();
  fixture.tick(); fixture.focus(); fixture.visibility("visible"); await settle();
  assert.equal(signals.length, 2, "unmounted views must no longer poll");
});

test("filesystem polling retries failures and ignores an aborted directory generation", async () => {
  const fixture = pollingFixture();
  let calls = 0;
  const stop = subscribeVisiblePolling(async () => { calls++; throw new Error("temporarily offline"); }, 2000, fixture.environment);
  fixture.tick(); await settle(); fixture.tick(); await settle();
  assert.equal(calls, 2);
  stop();
  const refreshed: string[] = [];
  let finish!: () => void;
  const old = subscribeVisiblePolling(async signal => {
    await new Promise<void>(resolve => { finish = resolve; });
    if (!signal.aborted) refreshed.push("old directory");
  }, 2000, fixture.environment);
  fixture.tick(); await settle(); old();
  const next = subscribeVisiblePolling(async () => { refreshed.push("new directory"); }, 2000, fixture.environment);
  finish(); fixture.tick(); await settle();
  assert.deepEqual(refreshed, ["new directory"]);
  next();
});

test("remote file content drops only gateway line prefixes and preserves indentation", () => {
  const gatewayOutput = [
    "     1\tfunction example() {",
    "     2\t\treturn true;",
    "     3\t  return false;",
    "     4\t}",
    "",
  ].join("\n");

  assert.equal(
    stripReadFileLinePrefixes(gatewayOutput),
    "function example() {\n\treturn true;\n  return false;\n}\n",
  );
});

test("remote file content is unchanged when it has no sequential gateway prefixes", () => {
  const content = "1. first item\n2. second item\n";
  assert.equal(stripReadFileLinePrefixes(content), content);
});

test("remote file editor inserts tab characters instead of spaces", () => {
  assert.match(editor, /detectIndentation: false/);
  assert.match(editor, /insertSpaces: false/);
  assert.match(editor, /lineNumbers: "on"/);
});

test("remote file editor uses app dialogs for folder creation and renaming", () => {
  assert.doesNotMatch(editor, /window\.prompt/);
  assert.match(editor, /entryDialogMode/);
  assert.match(editor, /<DialogTitle>\{entryDialogTitle\}<\/DialogTitle>/);
  assert.match(editor, /<form onSubmit=\{submitEntryDialog\}/);
});
