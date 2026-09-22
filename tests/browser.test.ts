import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("browser metadata does not wait the default Playwright locator timeout for favicons", () => {
  const source = readFileSync(path.join(root, "lib", "server-browser.ts"), "utf8");
  assert.match(source, /(?:document\.querySelector\('link\[rel~="icon"\]|page\.locator\('link\[rel~="icon"\])/);
  // Bounded lookup is fine: locator must be wrapped in withTimeout (no default Playwright 30s wait).
  assert.match(source, /withTimeout\(\s*page\.locator\('link\[rel~="icon"\][\s\S]{0,120}?5_000/);
  assert.match(source, /timeout: 15_000/);
});

test("browser engine fetch aborts instead of waiting forever", () => {
  const source = readFileSync(path.join(root, "lib", "shared-browser-client.ts"), "utf8");
  assert.match(source, /AbortSignal\.timeout\(90_000\)/);
});

test("idle browser sessions and ephemeral caches have bounded cleanup", () => {
  const browserSource = readFileSync(path.join(root, "lib", "server-browser.ts"), "utf8");
  const serverSource = readFileSync(path.join(root, "server.mjs"), "utf8");
  assert.match(browserSource, /SESSION_IDLE_MS = 15 \* 60 \* 1000/);
  assert.match(browserSource, /MAX_EPHEMERAL_CACHE_ENTRIES = 2_000/);
  assert.match(browserSource, /pruneEphemeralCaches\(\)/);
  assert.match(serverSource, /setInterval\(\(\) => \{/);
  assert.match(serverSource, /cleanupBrowserSessions\(\)/);
  assert.match(serverSource, /MAX_BROWSER_CONTEXT_SIGNATURES = 2_000/);
});
