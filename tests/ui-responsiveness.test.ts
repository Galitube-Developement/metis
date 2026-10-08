import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createMessageDerivationCache } from "../lib/message-derivation-cache";
import { scheduleUiBackgroundTask, shouldApplySnapshotVersion } from "../lib/ui-work-scheduling";
import { layoutAssistantParts } from "../lib/tool-call-display";
import { extractAssistantImages } from "../lib/assistant-images";
import { estimateContextTokens } from "../lib/context-window";

test("10000 unrelated UI updates reuse prepared large tool transcripts", () => {
  const derive = createMessageDerivationCache<object>();
  const parts = Array.from({ length: 120 }, (_, index) => ({
    type: "text" as const, content: ("A completed paragraph with a link https://example.com/ and some text.\n").repeat(60) + index,
  }));
  const message = { parts };
  let preparations = 0;
  const prepare = () => {
    preparations++;
    const blocks = layoutAssistantParts(parts);
    return blocks.map((block) => block.type === "text" ? extractAssistantImages(block.content) : block);
  };
  const expected = derive(message, [parts, "chat-a"], prepare);
  for (let index = 0; index < 10000; index++) assert.equal(derive(message, [parts, "chat-a"], prepare), expected);
  assert.equal(preparations, 1);
  const next = derive(message, [parts, "chat-b"], prepare);
  assert.notEqual(next, expected);
  assert.equal(preparations, 2);
});

test("unchanged context estimates do not serialize large tool payloads on menu updates", () => {
  const derive = createMessageDerivationCache<object>();
  let serializations = 0;
  const tools = [{ input: "x".repeat(1024 * 1024), toJSON() { serializations++; return { input: this.input }; } }];
  const message = { role: "assistant", content: "Completed", tools };
  const calculate = () => estimateContextTokens(message);
  const expected = derive(message, [message.role, message.content, tools], calculate);
  assert.equal(expected, calculate());
  serializations = 0;
  for (let index = 0; index < 10000; index++) assert.equal(derive(message, [message.role, message.content, tools], calculate), expected);
  assert.equal(serializations, 0);
  message.content = "Changed";
  derive(message, [message.role, message.content, tools], calculate);
  assert.equal(serializations, 1);
});

test("changed text, tool parts and attachment context invalidate prepared data", () => {
  const derive = createMessageDerivationCache<{ content: string }>();
  const message = { content: "before" };
  assert.equal(derive(message, [message.content], () => message.content), "before");
  message.content = "after";
  assert.equal(derive(message, [message.content], () => message.content), "after");
  const tools = [{ id: "tool", result: "running" }];
  const attachments = [{ storedName: "image.jpg" }];
  const first = derive(message, [tools, attachments, "chat-a"], () => ({ url: "/chat-a/image.jpg" }));
  const second = derive(message, [[...tools], attachments, "chat-a"], () => ({ url: "/chat-a/image.jpg" }));
  assert.notEqual(first, second);
  const third = derive(message, [tools, attachments, "chat-b"], () => ({ url: "/chat-b/image.jpg" }));
  assert.equal(third.url, "/chat-b/image.jpg");
});

test("duplicate polling snapshots are ignored but initial cache application and missing versions remain usable", () => {
  const version = "2026-10-05T00:00:00.000Z";
  assert.equal(shouldApplySnapshotVersion(undefined, version, true), true);
  assert.equal(shouldApplySnapshotVersion(version, version, true), false);
  assert.equal(shouldApplySnapshotVersion(version, "2026-10-04T00:00:00.000Z", true), false);
  assert.equal(shouldApplySnapshotVersion(version, "2026-10-05T00:00:00.001Z", true), true);
  assert.equal(shouldApplySnapshotVersion(version, version), true);
  assert.equal(shouldApplySnapshotVersion(version, undefined, true), true);
});

test("background work yields, is cancellable before and after idle registration, and has a portable fallback", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let timerCallback: (() => void) | undefined;
  let idleCallback: (() => void) | undefined;
  let cancelledIdle = 0;
  let tasks = 0;
  globalThis.setTimeout = ((callback: () => void) => { timerCallback = callback; return 123; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => { timerCallback = undefined; }) as typeof clearTimeout;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    requestIdleCallback: (callback: () => void, options: { timeout: number }) => {
      assert.equal(options.timeout, 1000); idleCallback = callback; return 456;
    },
    cancelIdleCallback: (id: number) => { assert.equal(id, 456); cancelledIdle++; },
  } });
  try {
    const before = scheduleUiBackgroundTask(() => tasks++);
    assert.equal(tasks, 0);
    before();
    assert.equal(timerCallback, undefined);

    const after = scheduleUiBackgroundTask(() => tasks++);
    timerCallback!();
    assert.equal(tasks, 0);
    after();
    idleCallback!();
    assert.equal(tasks, 0);
    assert.equal(cancelledIdle, 1);

    scheduleUiBackgroundTask(() => tasks++);
    timerCallback!();
    idleCallback!();
    assert.equal(tasks, 1);

    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    scheduleUiBackgroundTask(() => tasks++);
    timerCallback!();
    assert.equal(tasks, 2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("active view integration deduplicates refreshes and memoizes tool transcript preparation", () => {
  const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
  assert.ok(shell.includes("acceptServerSnapshot(chatId, data.chat.updatedAt, !activityChanged)"));
  assert.ok(shell.includes("chatRefreshInFlightRef.current.has(chatId)"));
  assert.ok(shell.includes("chatRefreshInFlightRef.current.delete(chatId)"));
  assert.ok(shell.includes("deriveAssistantView("));
  assert.ok(shell.includes("deriveMessageSources(m, [m.content]"));
  const chips = readFileSync(new URL("../components/tool-call-chip.tsx", import.meta.url), "utf8");
  assert.ok(chips.includes("}, [tools, includePlans]);"));
});
