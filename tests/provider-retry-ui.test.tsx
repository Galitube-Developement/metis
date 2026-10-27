import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ProviderRetryEvent } from "../components/provider-retry-event";
import { layoutAssistantParts } from "../lib/tool-call-display";
import { reconcileMessageParts } from "../lib/message-parts";
import type { MessagePart, ToolPart } from "../lib/store";

Object.assign(globalThis, { React });
const retry = {
  type: "provider-retry" as const, id: "retry:1", attempt: 1, maxRetries: 3,
  message: "Error occurred, continuing… (1/3)", detail: "Model is under capacity <details>",
};

test("retry event uses a collapsed native disclosure and escapes provider error details", () => {
  const html = renderToStaticMarkup(<ProviderRetryEvent event={retry} />);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /<summary/);
  assert.match(html, /Continuing Run… \(1\/3\)/);
  assert.doesNotMatch(html, /Error occurred, continuing/);
  assert.match(html, /Provider error/);
  assert.match(html, /role="status"/);
  assert.match(html, /Model is under capacity &lt;details&gt;/);
});

test("each saved retry keeps its own attempt and error, including retry-only messages", () => {
  const retries = [1, 2, 3].map(attempt => ({ ...retry, id: `retry:${attempt}`, attempt, detail: `Failure ${attempt}` }));
  const parts: MessagePart[] = JSON.parse(JSON.stringify(retries));
  const reconciled = reconcileMessageParts<ToolPart, MessagePart>({ parts, content: "" });
  const blocks = layoutAssistantParts<ToolPart>(reconciled);
  assert.deepEqual(blocks, retries);
  const html = renderToStaticMarkup(<>{retries.map(event => <ProviderRetryEvent key={event.id} event={event} />)}</>);
  for (const attempt of [1, 2, 3]) {
    assert.ok(html.includes(`Continuing Run… (${attempt}/3)`));
    assert.ok(html.includes(`Failure ${attempt}`));
  }
  assert.equal((html.match(/<details/g) || []).length, 3);
  assert.ok(html.indexOf("Failure 1") < html.indexOf("Failure 2"));
  assert.ok(html.indexOf("Failure 2") < html.indexOf("Failure 3"));
});

test("retry event survives persistence reconciliation between tools and following text", () => {
  const parts: MessagePart[] = [
    { type: "text", content: "Completed step." },
    { type: "tool", id: "tool", name: "fixture", status: "completed" },
    retry,
    { type: "text", content: "Next step." },
  ];
  const reconciled = reconcileMessageParts<ToolPart, MessagePart>({
    parts, content: "Completed step.Next step.",
  });
  assert.deepEqual(reconciled, parts);
  const blocks = layoutAssistantParts<ToolPart>(reconciled);
  assert.deepEqual(blocks.map(block => block.type), ["text", "tools", "provider-retry", "text"]);
  assert.deepEqual(blocks[2], retry);
});
