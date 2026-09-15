import assert from "node:assert/strict";
import test from "node:test";
import { createStreamTextBatcher } from "../lib/stream-ui-batch";

test("stream text batcher coalesces appends until flush", async () => {
  const received: string[] = [];
  const batcher = createStreamTextBatcher((chunk) => received.push(chunk), 20);
  batcher.push("Hel");
  batcher.push("lo");
  assert.deepEqual(received, []);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(received, ["Hello"]);
});

test("stream text batcher flush drains immediately", () => {
  const received: string[] = [];
  const batcher = createStreamTextBatcher((chunk) => received.push(chunk), 5_000);
  batcher.push("Hi");
  batcher.flush();
  assert.deepEqual(received, ["Hi"]);
  batcher.flush();
  assert.deepEqual(received, ["Hi"]);
});

test("stream text batcher clear drops pending chunks", () => {
  const received: string[] = [];
  const batcher = createStreamTextBatcher((chunk) => received.push(chunk), 5_000);
  batcher.push("Nope");
  batcher.clear();
  batcher.flush();
  assert.deepEqual(received, []);
});
