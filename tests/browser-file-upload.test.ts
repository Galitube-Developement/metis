import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-browser-upload-"));
Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AGENT_CWD: root });
test.after(() => rmSync(root, { recursive: true, force: true }));

test("real Chromium accepts named binary files via file input, drop zone, iframe and pending chooser", async () => {
  const store = await import("../lib/file-upload-store");
  const { uploadBrowserFiles, trackBrowserFileChooser, browserUploadFiles } = await import("../lib/browser-file-upload");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  trackBrowserFileChooser(page);
  async function upload(name: string, data: Uint8Array) {
    const file = store.createUpload("alice", { name, mimeType: "application/octet-stream", size: data.length });
    await store.appendUpload("alice", file.id, 0, new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }));
    store.completeUpload("alice", file.id); return file.id;
  }
  const bytes = new Uint8Array([0, 1, 127, 128, 255]), id = await upload("hello.bin", bytes), second = await upload("next.bin", bytes);
  try {
    assert.throws(() => browserUploadFiles("bob", [id]), /not found/);
    assert.throws(() => browserUploadFiles("alice", [id, id]), /Choose/);
    assert.throws(() => browserUploadFiles("alice", ["../outside"]), /not found/);
    await page.setContent('<label style="display:block;height:60px">Choose<input type="file" multiple></label>');
    await uploadBrowserFiles(page, "alice", [id, second], { x: 10, y: 20 });
    assert.deepEqual(await page.locator('input').evaluate(async input => Promise.all(Array.from((input as HTMLInputElement).files!).map(async file => ({ name: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) })))), [
      { name: "hello.bin", bytes: [...bytes] }, { name: "next.bin", bytes: [...bytes] },
    ]);
    await page.setContent('<div id="drop" style="height:150px">Drop</div><script>drop.ondragover=e=>e.preventDefault();drop.ondrop=async e=>{e.preventDefault();window.received=await Promise.all([...e.dataTransfer.files].map(async f=>({name:f.name,bytes:[...new Uint8Array(await f.arrayBuffer())]})))}</script>');
    await uploadBrowserFiles(page, "alice", [id, second], { x: 10, y: 30 });
    await page.waitForFunction(() => (window as unknown as { received?: unknown }).received);
    assert.deepEqual(await page.evaluate(() => (window as unknown as { received: unknown }).received), [
      { name: "hello.bin", bytes: [...bytes] }, { name: "next.bin", bytes: [...bytes] },
    ]);
    assert.equal(await page.locator("[data-metis-upload-staging]").count(), 0);
    await page.setContent('<p>Does not accept files</p>');
    await assert.rejects(uploadBrowserFiles(page, "alice", [id], { x: 10, y: 20 }), /does not accept/);
    assert.equal(await page.locator("[data-metis-upload-staging]").count(), 0);
    await page.setContent('<iframe style="margin:30px;border:0" srcdoc="<input type=file multiple style=width:250px;height:100px>"></iframe>');
    await page.frameLocator("iframe").locator("input").waitFor();
    await uploadBrowserFiles(page, "alice", [id], { x: 60, y: 60 });
    assert.equal(await page.frameLocator("iframe").locator("input").evaluate(input => (input as HTMLInputElement).files![0].name), "hello.bin");
    await page.setContent('<input id="one" type="file"><input id="two" type="file" multiple>');
    await assert.rejects(uploadBrowserFiles(page, "alice", [id]), /upload button first/);
    await Promise.all([page.waitForEvent("filechooser"), page.locator("#two").click()]);
    await uploadBrowserFiles(page, "alice", [id, second]);
    assert.equal(await page.locator("#two").evaluate(input => (input as HTMLInputElement).files!.length), 2);
    await Promise.all([page.waitForEvent("filechooser"), page.locator("#one").click()]);
    await assert.rejects(uploadBrowserFiles(page, "alice", [id, second]), /one file/);
    await uploadBrowserFiles(page, "alice", [id]);
    assert.equal(await page.locator("#one").evaluate(input => (input as HTMLInputElement).files![0].name), "hello.bin");
  } finally { await browser.close(); }
});
