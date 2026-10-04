import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveScreenshot } from "../lib/mcp-core/screenshot-artifacts.mjs";

test("captures persist as private, unique files inside the account workspace", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "metis-screenshots-"));
  try {
    const input = { workspace, chatId: "../../another-account", mimeType: "image/png", data: Buffer.from("test-image").toString("base64") };
    const first = await saveScreenshot(input);
    const second = await saveScreenshot(input);
    assert.notEqual(first.path, second.path);
    assert.ok(first.path.startsWith(path.join(workspace, ".metis", "screenshots") + path.sep));
    assert.equal(await fs.readFile(first.path, "utf8"), "test-image");
    assert.equal((await fs.stat(first.path)).mode & 0o777, 0o600);
    let provided;
    const shared = await saveScreenshot({ ...input, share: true, provideFile: async (file) => {
      provided = file;
      return { downloadUrl: "/api/uploads/chat/capture.png", markdown: "![Capture](/api/uploads/chat/capture.png)" };
    } });
    assert.equal(provided.path, shared.path);
    assert.match(shared.markdown, /^!\[/);
    assert.equal(provided.mimeType, "image/png");
    const failed = await saveScreenshot({ ...input, share: true, provideFile: async () => { throw new Error("attachment unavailable"); } });
    assert.equal(failed.shareError, "attachment unavailable");
    assert.equal(await fs.readFile(failed.path, "utf8"), "test-image");
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
});

test("storage requires an account workspace and nonempty supported image", async () => {
  await assert.rejects(saveScreenshot({ data: "aA==", mimeType: "image/png" }), /account workspace/);
  await assert.rejects(saveScreenshot({ workspace: "/unused", data: "", mimeType: "image/png" }), /no image data/);
  await assert.rejects(saveScreenshot({ workspace: "/unused", data: "aA==", mimeType: "text/plain" }), /Unsupported/);
});
