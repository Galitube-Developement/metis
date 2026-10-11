import assert from "node:assert/strict";
import test from "node:test";
import { codexUsageTotals, codexUsageFromRollout, codexUsageDelta, codexTurnUsage, codexCompletedUsage } from "../lib/providers/codex-usage";
const before = { inputTokens: 436289230, outputTokens: 1430160, cachedInputTokens: 426371712, cacheWriteInputTokens: 0 };
const after = { inputTokens: 441602287, outputTokens: 1455889, cachedInputTokens: 431479680, cacheWriteInputTokens: 0 };
const consumed = { inputTokens: 5313057, outputTokens: 25729, cachedInputTokens: 5107968, cacheWriteInputTokens: 0 };
test("resumed Codex lifetime counters count only the new turn, including cache exactly once", () => {
  assert.deepEqual(codexTurnUsage(after, before, after, true), consumed);
  assert.equal(consumed.inputTokens + consumed.outputTokens, 5338786);
  assert.deepEqual(codexTurnUsage(after, before, undefined, true), consumed);
});
test("SDK turn totals remain unchanged when native counters prove they are already deltas", () => {
  assert.deepEqual(codexTurnUsage(consumed, before, after, true), consumed);
});
test("fresh threads, zero usage and missing baselines remain distinct", () => {
  assert.deepEqual(codexTurnUsage(consumed, undefined, consumed, false), consumed);
  assert.deepEqual(codexTurnUsage(after, before, undefined, false), after);
  assert.equal(codexTurnUsage(after, undefined, after, true), undefined);
  assert.deepEqual(codexUsageDelta(after, after), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0 });
});
test("counter resets, malformed counters and contradictory native evidence never charge lifetime totals", () => {
  assert.equal(codexUsageDelta(before, after), undefined);
  assert.equal(codexTurnUsage(after, before, consumed, true), undefined);
  assert.equal(codexUsageTotals({ input_tokens: Infinity, output_tokens: 1 }), undefined);
  assert.equal(codexUsageTotals({ input_tokens: -1, output_tokens: 1 }), undefined);
  assert.equal(codexUsageTotals({ input_tokens: 1.5, output_tokens: 1 }), undefined);
  assert.deepEqual(codexUsageTotals({ input_tokens: 8, output_tokens: 5, reasoning_output_tokens: 3, total_tokens: 13 }), { inputTokens: 8, outputTokens: 5 });
});
const native = (usage: typeof before) => ({ input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cached_input_tokens: usage.cachedInputTokens, cache_write_input_tokens: usage.cacheWriteInputTokens });
const event = (type: string, extra = {}, timestamp = "2026-10-11T18:35:58.503Z") => JSON.stringify({ timestamp, type: "event_msg", payload: { type, ...extra } });
const tokens = (usage: typeof before) => event("token_count", { info: { total_token_usage: native(usage) } });
async function* lines(items: string[]) { yield* items; }
test("rollout usage reads the latest valid cumulative counter and ignores partial writes", () => {
  assert.deepEqual(codexUsageFromRollout(["partial", tokens(before), tokens(after), '{"partial":'].join("\n")), after);
});
test("historical repair uses exact native turn boundaries, not differences between stored answers", async () => {
  const turns = await codexCompletedUsage(lines([JSON.stringify({ type: "session_meta" }), tokens(before), event("task_started"), tokens(after), event("task_complete")]));
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0].usage, consumed);
  assert.deepEqual(turns[0].cumulative, after);
});
test("first native turn starts at zero; incomplete and aborted turns are not historical repairs", async () => {
  const complete = await codexCompletedUsage(lines([JSON.stringify({ type: "session_meta" }), event("task_started"), tokens(before), event("task_complete")]));
  assert.deepEqual(complete[0].usage, before);
  const truncated = await codexCompletedUsage(lines([event("task_started"), tokens(before), event("task_complete")]));
  assert.equal(truncated.length, 0);
  const aborted = await codexCompletedUsage(lines([JSON.stringify({ type: "session_meta" }), event("task_started"), tokens(before), event("turn_aborted"), event("task_complete"), event("task_started"), tokens(after)]));
  assert.equal(aborted.length, 0);
});
test("a new native turn excludes usage of a previously interrupted turn", async () => {
  const turns = await codexCompletedUsage(lines([JSON.stringify({ type: "session_meta" }), event("task_started"), tokens(before), event("task_started"), tokens(after), event("task_complete")]));
  assert.deepEqual(turns[0].usage, consumed);
});
