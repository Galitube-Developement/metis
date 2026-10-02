import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  codexCachedContextWindow,
  codexContextFromRollout,
  readCodexThreadContext,
} from "../lib/providers/codex-context";
import { contextWindowOf } from "../lib/context-window";

function tokenEvent(input = 118_700, output = 5_072, window = 258_400) {
  return JSON.stringify({ type: "event_msg", payload: {
    type: "token_count", info: {
      total_token_usage: { input_tokens: 8_808_061, total_tokens: 8_852_992 },
      last_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
      model_context_window: window,
    },
  } });
}

test("Codex context uses the latest native usage instead of accumulated millions of tokens", () => {
  assert.deepEqual(codexContextFromRollout([
    "truncated start", tokenEvent(100_000), tokenEvent(), '{"unfinished":',
  ].join("\n")), { usedTokens: 123_772, maxTokens: 258_400 });
  assert.equal(codexContextFromRollout(JSON.stringify({ type: "event_msg", payload: {
    type: "token_count", info: { total_token_usage: { total_tokens: 8_852_992 } },
  } })), undefined);
  assert.deepEqual(codexContextFromRollout(tokenEvent(0, 0)), { usedTokens: 0, maxTokens: 258_400 });
  assert.equal(contextWindowOf({ modelContextWindow: 258_400 }), 258_400);
});

test("Codex cache metadata matches the exact model and keeps missing windows unknown", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "metis-codex-context-"));
  try {
    assert.equal(codexCachedContextWindow(home, "new-model"), undefined);
    writeFileSync(path.join(home, "models_cache.json"), JSON.stringify({
      models: [{ slug: "new-model", context_window: 272_000 }],
    }));
    assert.equal(codexCachedContextWindow(home, "new-model"), 272_000);
    assert.equal(codexCachedContextWindow(home, "other-model"), undefined);
    writeFileSync(path.join(home, "models_cache.json"), "invalid");
    assert.equal(codexCachedContextWindow(home, "new-model"), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("native rollout reading is bounded, thread-specific and tolerates partial writes", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "metis-codex-context-"));
  const threadId = "01a0f224-3a68-7601-bbaa-289fb1864053";
  try {
    const dir = path.join(home, "sessions", "2026", "09", "30");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `rollout-date-${threadId}.jsonl`),
      "x".repeat(2 * 1024 * 1024) + "\n" + tokenEvent() + "\n" + '{"partial":');
    assert.deepEqual(readCodexThreadContext(home, threadId), { usedTokens: 123_772, maxTokens: 258_400 });
    assert.equal(readCodexThreadContext(home, "01a0f224-3a68-7601-bbaa-289fb1864054"), undefined);
    assert.equal(readCodexThreadContext(home, "../models_cache.json"), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
