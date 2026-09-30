import assert from "node:assert/strict";
import test from "node:test";
import { codexEventsWithResumeRetry } from "../lib/providers/codex-resume";

const conflict = "Codex Exec exited with code 1: thread-store conflict: thread fixture already has an active writer";
async function collect<T>(events: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

test("native resume waits for an exiting writer and emits each successful event once", async () => {
  let attempts = 0;
  let cleaned = 0;
  const events = await collect(codexEventsWithResumeRetry(async () => (async function* () {
    try {
      if (++attempts < 3) throw new Error(conflict);
      yield { type: "thread.started" };
      yield { type: "turn.completed" };
    } finally { cleaned++; }
  })(), { resume: true, retryMs: 1 }));
  assert.equal(attempts, 3);
  assert.equal(cleaned, 3);
  assert.deepEqual(events.map((event) => event.type), ["thread.started", "turn.completed"]);
});

test("a startup writer-conflict error event is retried before exposing it as a failed run", async () => {
  let attempts = 0;
  const events = await collect(codexEventsWithResumeRetry(async () => (async function* () {
    if (++attempts === 1) yield { type: "error", message: conflict };
    else yield { type: "turn.completed" };
  })(), { resume: true, retryMs: 1 }));
  assert.equal(attempts, 2);
  assert.equal(events.length, 1);
});

test("a turn which already started cannot be replayed after a conflict", async () => {
  let attempts = 0;
  await assert.rejects(collect(codexEventsWithResumeRetry(async () => (async function* () {
    attempts++;
    yield { type: "thread.started" };
    throw new Error(conflict);
  })(), { resume: true, retryMs: 1 })), /active writer/);
  assert.equal(attempts, 1);
});

test("fresh threads and unrelated native failures are never retried", async () => {
  for (const [resume, message] of [[false, conflict], [true, "Invalid API key"]] as const) {
    let attempts = 0;
    await assert.rejects(collect(codexEventsWithResumeRetry(async () => {
      attempts++;
      throw new Error(message);
    }, { resume, retryMs: 1 })), { message });
    assert.equal(attempts, 1);
  }
});

test("a persistent writer conflict remains a bounded, explicit failure", async () => {
  let attempts = 0;
  await assert.rejects(collect(codexEventsWithResumeRetry(async () => {
    attempts++;
    throw new Error(conflict);
  }, { resume: true, timeoutMs: 15, retryMs: 2 })), /active writer/);
  assert.ok(attempts > 1 && attempts < 30);
});

test("cancelling the writer grace period stops retries immediately", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const pending = collect(codexEventsWithResumeRetry(async () => {
    attempts++;
    setTimeout(() => controller.abort(), 5);
    throw new Error(conflict);
  }, { resume: true, signal: controller.signal, retryMs: 100 }));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(attempts, 1);
});
