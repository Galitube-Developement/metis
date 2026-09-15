import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { browserFrameVisible, browserViewportPhase } from "../lib/browser-viewport-phase";
import { shouldFlushStreamingRender } from "../lib/streaming-render";

const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const markdown = readFileSync(new URL("../components/markdown.tsx", import.meta.url), "utf8");

test("browser viewport is empty without url or frame", () => {
  assert.equal(browserViewportPhase({ loading: false, hasFrame: false, url: "" }), "empty");
  assert.equal(browserViewportPhase({ loading: false, hasFrame: true, url: "" }), "empty");
});

test("browser viewport shows skeleton while loading", () => {
  assert.equal(browserViewportPhase({ loading: true, hasFrame: false, url: "" }), "loading");
  assert.equal(browserViewportPhase({ loading: true, hasFrame: true, url: "https://example.com" }), "loading");
});

test("browser viewport is live when a framed url is ready", () => {
  assert.equal(browserViewportPhase({ loading: false, hasFrame: true, url: "https://example.com" }), "live");
  assert.equal(browserFrameVisible({ loading: false, hasFrame: true, url: "https://example.com" }), true);
  assert.equal(browserFrameVisible({ loading: true, hasFrame: true, url: "https://example.com" }), true);
  assert.equal(browserFrameVisible({ loading: false, hasFrame: true, url: "" }), false);
});

test("streaming markdown flushes replacements and throttles appends", () => {
  assert.equal(shouldFlushStreamingRender("Hel", "Hello"), false);
  assert.equal(shouldFlushStreamingRender("Hello", "Hi"), true);
  assert.equal(shouldFlushStreamingRender("Hello", "Hello"), false);
});

test("app shell wires batched streams and browser viewport phases", () => {
  assert.match(shell, /createStreamTextBatcher\(applyStreamText\)/);
  assert.match(shell, /if \(!liveRun\) \{\s*setMessages\(\(current\) => mergeMessages/);
  assert.match(shell, /data-browser-phase=\{browserPhase\}/);
  assert.match(shell, /<BrowserPageSkeleton \/>/);
  assert.match(shell, /<BrowserPageEmpty \/>/);
  assert.match(markdown, /shouldFlushStreamingRender\(current, next\)/);
});
