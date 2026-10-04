import assert from "node:assert/strict";
import test from "node:test";
import { extractAssistantImages, uniqueAssistantImages } from "../lib/assistant-images";

test("collects inline and reference images while preserving surrounding prose and links", () => {
  const result = extractAssistantImages('Before ![One](https://example.com/a.png "Title") after.\n\n![Two][photo]\n\n[photo]: /api/uploads/chat/two.png\n\n[Download](/file.pdf)');
  assert.deepEqual(result.images, [
    { src: "https://example.com/a.png", alt: "One" },
    { src: "/api/uploads/chat/two.png", alt: "Two" },
  ]);
  assert.ok(result.content.includes("Before  after."));
  assert.ok(result.content.includes("[Download](/file.pdf)"));
  assert.ok(!result.content.includes("!["));
});
test("does not extract code examples, escaped syntax or incomplete streaming images", () => {
  const content = '\`![Example](/example.png)\`\n\n\`\`\`md\n![Code](/code.png)\n\`\`\`\n\n\\![Escaped](/escaped.png)\n\n![Pending](https://example.com/';
  assert.deepEqual(extractAssistantImages(content), { content, images: [] });
});
test("ignores unsafe URLs and deduplicates images across attachments and text", () => {
  assert.equal(extractAssistantImages("![Bad](javascript:alert)").images.length, 0);
  assert.deepEqual(uniqueAssistantImages([
    { src: "/one.png", alt: "First" }, { src: "/one.png", alt: "Again" }, { src: "/two.png", alt: "Second" },
  ]), [{ src: "/one.png", alt: "First" }, { src: "/two.png", alt: "Second" }]);
});
