import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { mergeChatMessages } from "../lib/tool-call-display";
import { advanceLiveMessageMotion, initialLiveMessageMotion, toolMotionKey } from "../lib/live-message-motion";
import { appendStreamingArrival, initialStreamingArrival, initialStreamingText, appendStreamingText, STREAM_STAGGER_MS, STREAM_FADE_MS } from "../lib/streaming-text";
import rehypeStreamingText from "../lib/rehype-streaming-text";
import { StreamingSpan } from "../components/streaming-text";
import { ArrivalFade } from "../components/arrival-fade";
Object.assign(globalThis, { React });

test("a stale checkpoint cannot adopt the previous assistant response into a new run", () => {
  const old = { id: "old", role: "assistant", streaming: undefined as boolean | undefined, content: "Previous answer", createdAt: "2026-10-13T09:00:00Z" };
  const prompt = { id: "user-new", role: "user", streaming: undefined as boolean | undefined, content: "New prompt", createdAt: "2026-10-13T09:01:00Z" };
  const pending = { id: "a-local", role: "assistant", content: "", streaming: true, createdAt: "2026-10-13T09:01:00Z" };
  for (const checkpoint of [[old], [old, prompt]]) {
    const merged = mergeChatMessages([old, prompt, pending], checkpoint);
    assert.equal(merged.find((message) => message.id === "old")!.streaming, undefined);
    assert.ok(merged.some((message) => message.id === pending.id));
    assert.equal(merged.length, 3);
  }
  const current = { ...pending, id: "server-new", content: "New answer" };
  const adopted = mergeChatMessages([old, prompt, pending], [old, prompt, current]);
  assert.deepEqual(adopted.map((message) => message.id), ["old", prompt.id, current.id]);
  assert.equal(adopted[2].content, "New answer");
  assert.equal(adopted[0].streaming, undefined);
});

test("loading history, sending a user message and repeating snapshots never mark old content as new", () => {
  const history = [{ id: "old", role: "assistant", content: "Visible text", tools: [{ id: "old-tool" }] }];
  let state = initialLiveMessageMotion("chat", history);
  assert.equal(advanceLiveMessageMotion(state, "chat", history, 10), state);
  state = advanceLiveMessageMotion(state, "chat", [...history, { id: "user", role: "user", content: "Next" }], 20);
  assert.equal(state.messageBirths.size, 0);
  assert.equal(state.toolBirths.size, 0);
  const loading = advanceLiveMessageMotion(state, "other", history, 30, true);
  assert.equal(advanceLiveMessageMotion(loading, "other", history, 40, true), loading, "Loading rerenders must settle");
  const loaded = advanceLiveMessageMotion(loading, "other", [...history, { id: "partial", role: "assistant", content: "Restored partial answer" }], 50);
  assert.equal(loaded.messageBirths.size, 0);
  assert.equal(loaded.toolBirths.size, 0);
});

test("snapshot text appends and new call IDs animate independently of a streaming flag", () => {
  const first = { id: "a", role: "assistant", content: "Hello", tools: [{ id: "one" }] };
  let state = initialLiveMessageMotion("chat", [first]);
  state = advanceLiveMessageMotion(state, "chat", [{ ...first, content: "Hello world", tools: [...first.tools, { id: "two" }] }], 100);
  assert.equal(state.messageBirths.get("a"), 100);
  assert.equal(state.toolBirths.get(toolMotionKey("a", "two")), 100);
  assert.equal(state.toolBirths.has(toolMotionKey("a", "one")), false);
  const stable = advanceLiveMessageMotion(state, "chat", [{ ...first, content: "Hello world", tools: [...first.tools, { id: "two" }] }], 110);
  assert.equal(stable, state, "Status and argument updates do not restart a fade");
  const expired = advanceLiveMessageMotion(state, "chat", [{ ...first, content: "Hello world", tools: [...first.tools, { id: "two" }] }], 100 + STREAM_FADE_MS);
  assert.equal(expired.messageBirths.size, 0);
  assert.equal(expired.toolBirths.size, 0);
});

test("older pagination and text replacements are not fresh output", () => {
  const first = { id: "known", role: "assistant", content: "Existing response" };
  const state = initialLiveMessageMotion("chat", [first]);
  const older = advanceLiveMessageMotion(state, "chat", [{ id: "older", role: "assistant", content: "History", tools: [{ id: "historic" }] }, first], 50);
  assert.equal(older.messageBirths.size, 0);
  assert.equal(older.toolBirths.size, 0);
  const replaced = advanceLiveMessageMotion(state, "chat", [{ ...first, content: "Corrected response is longer" }], 60);
  assert.equal(replaced.messageBirths.size, 0);
});

test("initial text uses a stable history prefix and remounts respect the original fade time", () => {
  const stable = initialStreamingText("History and new", 100, 12, 90);
  assert.equal(stable.prefix, "History and ");
  assert.equal(stable.segments[0].text, "new");
  assert.equal(stable.segments[0].delay, 10);
  const expired = initialStreamingText("History and new", 1000, 12, 90);
  assert.equal(expired.prefix, "History and new");
  assert.equal(expired.segments.length, 0);
  let arrival = initialStreamingArrival("History", 0);
  assert.equal(arrival.from, 7);
  arrival = appendStreamingArrival(arrival, "History new", 100);
  assert.equal(arrival.from, 7);
  assert.equal(appendStreamingArrival(arrival, arrival.text, 150), arrival);
  assert.equal(appendStreamingArrival(arrival, "Replacement", 200).from, 11);
});

test("Markdown reparse fades only fresh prose, with escaped characters and entities counted correctly", (t) => {
  t.mock.method(Date, "now", () => 100);
  const render = (source: string, from: number) => renderToStaticMarkup(<ReactMarkdown rehypePlugins={[[rehypeStreamingText, { from, source, born: 100 }]]} components={{ span: StreamingSpan }}>{source}</ReactMarkdown>);
  const bold = render("Old **bold** new", 10);
  assert.doesNotMatch(bold, /<strong><span class="stream-token-fade">bold/);
  assert.match(bold, /<span class="stream-token-fade"> new/);
  const escaped = render("A\\* &amp; new", 9);
  assert.match(escaped, /<span class="stream-token-fade"> new/);
  const history = render("## Loaded history", 17);
  assert.doesNotMatch(history, /stream-token-fade/);
});

test("arrival fades leave historical and expired rows opaque and resume fresh rows at their original age", (t) => {
  t.mock.method(Date, "now", () => 1000);
  const html = renderToStaticMarkup(<><ArrivalFade bornAt={0}>Old tool</ArrivalFade><ArrivalFade bornAt={900}>New tool</ArrivalFade></>);
  assert.equal((html.match(/class="stream-token-fade"/g) || []).length, 1);
  assert.match(html, /animation-delay:-100ms/);
  const historical = renderToStaticMarkup(<ArrivalFade>Historical tool</ArrivalFade>);
  assert.doesNotMatch(historical, /stream-token-fade/);
});

 test("checkpoint arrivals stagger complete graphemes with bounded delay and preserve old span IDs", () => {
 const history = initialStreamingText("Visible history", 0, 15);
 const tail = " 😀ä新é more smooth words ".repeat(12);
 const next = appendStreamingText(history, history.text + tail, 100);
 assert.equal(next.prefix, history.text);
 assert.equal(next.segments.map(s => s.text).join(""), tail);
 assert.ok(next.segments.length > 1);
 assert.ok(next.segments.some(s => (s.delay ?? 0) < 0));
 assert.ok(next.segments.every(s => s.born - 100 <= STREAM_STAGGER_MS));
 const updated = appendStreamingText(next, next.text + " appended", 200);
 assert.deepEqual(updated.segments.slice(0, next.segments.length), next.segments);
 const settled = appendStreamingText(updated, updated.text + "!", 2000);
 assert.equal(settled.prefix, updated.text);
 assert.equal(settled.segments.map(s => s.text).join(""), "!");
});
