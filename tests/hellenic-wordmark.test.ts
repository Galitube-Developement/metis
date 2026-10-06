import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const wordmark = readFileSync(path.join(root, "public/metis-wordmark.svg"), "utf8");
const favicon = readFileSync(path.join(root, "public/favicon.svg"), "utf8");

test("logo assets contain outlines without font or external resource dependencies", () => {
  for (const svg of [wordmark, favicon]) {
    assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.doesNotMatch(svg, /<text\b|<image\b|@font-face|font-family|href=|url\(/i);
    const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1].split(" ").map(Number);
    assert.ok(viewBox?.length === 4 && viewBox.every(Number.isFinite));
    assert.ok(viewBox[2] > 0 && viewBox[3] > 0);
  }
  assert.equal((wordmark.match(/<path\b/g) || []).length, 5);
  assert.match(wordmark, /data-letter="M"/);
  for (const letter of "ῆτις") assert.ok(wordmark.includes(`data-letter="${letter}"`));
  const initialOutline = wordmark.match(/<path data-letter="M"[^>]* d="([^"]+)"/)?.[1];
  const faviconOutline = favicon.match(/<path[^>]* d="([^"]+)"/)?.[1];
  assert.ok(initialOutline);
  assert.equal(faviconOutline, initialOutline);
});

test("sidebar and favicon use the vector assets with theme-aware color and accessible name", () => {
  const shell = readFileSync(path.join(root, "components/app-shell.tsx"), "utf8");
  const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
  assert.match(shell, /role="img" aria-label="Metis" className="metis-wordmark/);
  assert.match(css, /mask: url\("\/metis-wordmark.svg"\)/);
  assert.match(css, /background-color: currentColor/);
  assert.match(layout, /url: "\/favicon.svg", type: "image\/svg\+xml"/);
  assert.doesNotMatch(layout, /GFS_Didot|font-wordmark/);
  assert.doesNotMatch(css, /@font-face|monotype-corsiva-m\.woff/);
  assert.match(favicon, /prefers-color-scheme:dark/);
});
