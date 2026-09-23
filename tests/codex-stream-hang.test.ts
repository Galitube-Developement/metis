import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  activeInFlightTool,
  iterateUntilAborted,
} from "../lib/providers/stream-guard";

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
  assert.match(codex, /iterateUntilAborted\(streamed\.events/);
  assert.match(codex, /service_tier: serviceTier/);
  assert.match(support, /return openai\.responses\(modelId\)/);
  assert.doesNotMatch(support, /openai\.chat\(modelId\)/);
  assert.match(support, /iterateUntilAborted\(\s*streamResult\.stream/);
  assert.match(runner, /activeInFlightTool\(tools\)/);
});
