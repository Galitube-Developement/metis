import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexResetFromRollout, codexLimitErrorFromRollout } from "../lib/providers/codex-rate-limit";
import { providerRateLimit } from "../lib/provider-rate-limit";
const now = Date.parse("2026-10-10T10:00:00Z");
const event = (rate_limits: unknown, at = now) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: "event_msg", payload: { type: "token_count", rate_limits } });
test("Codex uses only fresh, exhausted native windows and the last snapshot", () => {
  const primary = { used_percent: 100, resets_at: (now + 3600000) / 1000 };
  const secondary = { used_percent: 100, resets_at: (now + 7200000) / 1000 };
  assert.equal(codexResetFromRollout(event({ primary, secondary }), now, now), new Date(now + 7200000).toISOString());
  assert.equal(codexResetFromRollout(event({ primary }, now - 1000), now, now), undefined);
  assert.equal(codexResetFromRollout(event({ primary: { used_percent: 99, resets_at: primary.resets_at } }), now, now), undefined);
  assert.equal(codexResetFromRollout(event({ primary }) + "\n" + event({ primary: { used_percent: 0 } }), now, now), undefined);
  assert.equal(codexResetFromRollout(event({ primary: { used_percent: 100 } }), now, now), undefined);
});
test("exact thread telemetry enriches an explicit limit, never a foreign failure", t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const home = mkdtempSync(path.join(os.tmpdir(), "metis-codex-limit-"));
  try {
    mkdirSync(path.join(home, "sessions"));
    const thread = "12345678-1234-1234-1234-123456789012";
    const reset = now + 60000;
    writeFileSync(path.join(home, "sessions", `rollout-${thread}.jsonl`), event({ primary: { used_percent: 100, resets_at: reset / 1000 } }));
    assert.equal(providerRateLimit(codexLimitErrorFromRollout({ message: "You've hit your usage limit." }, home, thread, now))?.resetAt, new Date(reset).toISOString());
    assert.equal(providerRateLimit(codexLimitErrorFromRollout({ message: "Authentication failed" }, home, thread, now)), null);
    assert.equal(providerRateLimit(codexLimitErrorFromRollout({ message: "You've hit your usage limit." }, home, "../other", now)), null);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test("API resets use header semantics and billing/auth errors never retry", () => {
  assert.equal(providerRateLimit({ statusCode: 429, responseHeaders: { "ratelimit-reset": "60" } }, now)?.resetAt, new Date(now + 60000).toISOString());
  assert.equal(providerRateLimit({ statusCode: 429, responseHeaders: { "x-ratelimit-reset-tokens": "1m30s" } }, now)?.resetAt, new Date(now + 90000).toISOString());
  assert.equal(providerRateLimit({ statusCode: 429, responseHeaders: { "retry-after": "60" }, responseBody: '{"error":{"code":"insufficient_quota"}}' }, now), null);
  assert.equal(providerRateLimit({ statusCode: 401, message: "rate limit reached; resets at 2026-10-10T12:00:00Z" }, now), null);
});
