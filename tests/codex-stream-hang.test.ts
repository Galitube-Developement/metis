import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  activeInFlightTool,
  iterateUntilAborted,
  providerIdleTimeouts,
} from "../lib/providers/stream-guard";

test("buffered SDK generation survives the observed three-minute silence and stays bounded", () => {
  const buffered = providerIdleTimeouts("buffered", {});
  const continuous = providerIdleTimeouts("continuous", {});
  for (const silenceMs of [182_000, 183_000, 184_000]) {
    assert.ok(silenceMs < buffered.providerIdleMs);
    assert.ok(silenceMs >= continuous.providerIdleMs);
  }
  assert.equal(buffered.providerIdleMs, 15 * 60_000);
  assert.equal(buffered.providerToolIdleMs, 30 * 60_000);
  assert.equal(providerIdleTimeouts(undefined, {}).providerIdleMs, continuous.providerIdleMs);
});

test("silence overrides remain authoritative and active tools keep their own limit", () => {
  assert.equal(
    providerIdleTimeouts("buffered", { AI_CHAT_PROVIDER_IDLE_MS: "240000" }).providerIdleMs,
    240_000,
  );
  assert.deepEqual(providerIdleTimeouts("buffered", {
    AI_CHAT_PROVIDER_IDLE_MS: "240000",
    AI_CHAT_PROVIDER_BUFFERED_IDLE_MS: "1200000",
    AI_CHAT_PROVIDER_TOOL_IDLE_MS: "600000",
  }), { providerIdleMs: 1_200_000, providerToolIdleMs: 1_200_000 });
  assert.equal(providerIdleTimeouts("continuous", {
    AI_CHAT_PROVIDER_BUFFERED_IDLE_MS: "1200000",
  }).providerIdleMs, 180_000);
  assert.equal(providerIdleTimeouts("buffered", {
    AI_CHAT_PROVIDER_BUFFERED_IDLE_MS: "1",
  }).providerIdleMs, 60_000);
});

test("invalid silence configuration cannot disable the watchdog", () => {
  for (const value of ["", " ", "NaN", "Infinity", "-1", "0"]) {
    assert.deepEqual(providerIdleTimeouts("buffered", {
      AI_CHAT_PROVIDER_IDLE_MS: value,
      AI_CHAT_PROVIDER_BUFFERED_IDLE_MS: value,
      AI_CHAT_PROVIDER_TOOL_IDLE_MS: value,
    }), { providerIdleMs: 900_000, providerToolIdleMs: 1_800_000 });
  }
});

test("stale earlier running tools do not keep the long stall window", () => {
  const tools = [
    { name: "Codex command", status: "running" },
    { name: "browser_navigate", status: "completed" },
    { name: "Tasks", status: "completed" },
  ];
  assert.equal(activeInFlightTool(tools), undefined);
  assert.equal(
    activeInFlightTool([
      { name: "read_file", status: "completed" },
      { name: "Codex command", status: "running" },
    ])?.name,
    "Codex command",
  );
});

test("iterateUntilAborted unblocks a hung provider stream on abort", async () => {
  const controller = new AbortController();
  let settleNext: ((value: IteratorResult<string>) => void) | undefined;
  const hungNext = new Promise<IteratorResult<string>>((resolve) => {
    settleNext = resolve;
  });
  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => ({
      next: () => hungNext,
      return: async () => {
        settleNext?.({ done: true, value: undefined as unknown as string });
        return { done: true, value: undefined as unknown as string };
      },
    }),
  };
  const consume = (async () => {
    for await (const item of iterateUntilAborted(iterable, controller.signal)) {
      void item;
    }
  })();
  controller.abort();
  await assert.rejects(consume, /aborted/i);
});

test("Codex adapter and OpenAI factory wire the hang guards", () => {
  const codex = readFileSync(new URL("../lib/providers/adapters/codex.ts", import.meta.url), "utf8");
  const support = readFileSync(new URL("../lib/providers/adapters/provider-support.ts", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../lib/providers/runner.ts", import.meta.url), "utf8");
  assert.match(codex, /codexEventsWithResumeRetry/);
  assert.match(codex, /service_tier: serviceTier/);
  assert.match(support, /return openai\.responses\(modelId\)/);
  assert.doesNotMatch(support, /openai\.chat\(modelId\)/);
  assert.match(support, /iterateUntilAborted\(\s*streamResult\.stream/);
  assert.match(runner, /activeInFlightTool\(tools\)/);
  assert.match(runner, /providerIdleTimeouts\(\s*adapter\.capabilities\.progressDelivery/);
  assert.match(codex, /progressDelivery: "buffered"/);
});
