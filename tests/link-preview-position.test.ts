import assert from "node:assert/strict";
import test from "node:test";
import { positionLinkPreview } from "../lib/link-preview-position";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  bottom: top + height,
  width,
  height,
});

test("link preview stays within the viewport near the top and right edges", () => {
  assert.deepEqual(
    positionLinkPreview(rect(370, 4, 40, 18), rect(0, 0, 288, 150), 390, 800),
    { left: 94, top: 30 },
  );
});

test("link preview stays above the link when space is available", () => {
  assert.deepEqual(
    positionLinkPreview(rect(24, 300, 40, 18), rect(0, 0, 288, 150), 390, 800),
    { left: 24, top: 142 },
  );
});

test("link preview clamps vertically when neither side has enough room", () => {
  assert.deepEqual(
    positionLinkPreview(rect(0, 60, 40, 18), rect(0, 0, 288, 280), 390, 320),
    { left: 8, top: 32 },
  );
});
