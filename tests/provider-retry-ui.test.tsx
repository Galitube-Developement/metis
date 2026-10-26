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
  assert.match(html, /Error occurred, continuing… \(1\/3\)/);
  assert.match(html, /Model is under capacity &lt;details&gt;/);
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
