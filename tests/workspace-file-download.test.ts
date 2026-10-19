import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { workspaceFileDownload } from "../lib/workspace-file-download";

test("file downloads preserve binary bytes, complete large text, empty files and Unicode names", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-file-download-"));
  try {
    const req = new Request("http://localhost/api/remote/download");
    for (const [name, data] of [
      ["Größe.bin", Buffer.from([0, 255, 1, 13, 10, 128])],
      ["long.txt", Buffer.from("Überprüfung\r\n".repeat(10_000) + "END")],
      ["empty.txt", Buffer.alloc(0)],
    ] as const) {
      const file = path.join(root, name);
      writeFileSync(file, data);
      const response = workspaceFileDownload(root, file, req);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), data);
      assert.match(response.headers.get("Content-Disposition")!, /^attachment;/);
      assert.ok(response.headers.get("Content-Disposition")!.includes(encodeURIComponent(name)));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inline workspace previews preserve media MIME, seeking and safe download-only formats", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-file-preview-"));
  try {
    for (const [name, mime] of [["clip.mp4", "video/mp4"], ["sound.mp3", "audio/mpeg"], ["image.png", "image/png"], ["document.pdf", "application/pdf"]]) {
      const file = path.join(root, name); writeFileSync(file, "0123456789");
      const response = workspaceFileDownload(root, file, new Request("http://localhost/api/remote/preview", { headers: { Range: "bytes=3-6" } }), {inline:true});
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-type"), mime);
      assert.match(response.headers.get("content-disposition")!, /^inline;/);
      assert.equal(response.headers.get("content-range"), "bytes 3-6/10");
      assert.equal(await response.text(), "3456");
      const head = workspaceFileDownload(root, file, new Request("http://localhost/api/remote/preview", {method:"HEAD"}), {inline:true});
      assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), "10"); assert.equal(await head.text(), "");
    }
    for (const name of ["active.html", "active.svg", "source.js", "unknown.bin"]) {
      writeFileSync(path.join(root, name), "<script>parent.document.body.remove()</script>");
      assert.equal(workspaceFileDownload(root, name, new Request("http://localhost/api/remote/preview"), {inline:true}).status, 415);
    }
    assert.equal(workspaceFileDownload(root, "../outside.mp4", new Request("http://localhost/api/remote/preview"), {inline:true}).status,403);
  } finally { rmSync(root, {recursive:true,force:true}); }
});

test("file downloads reject traversal, symlink escapes, directories and missing files", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "metis-file-boundary-"));
  const root = path.join(dir, "owner-a");
  mkdirSync(root);
  writeFileSync(path.join(dir, "private.txt"), "owner-b secret");
  symlinkSync(path.join(dir, "private.txt"), path.join(root, "escape.txt"));
  const req = new Request("http://localhost/api/remote/download");
  try {
    assert.equal(workspaceFileDownload(root, "../private.txt", req).status, 403);
    assert.equal(workspaceFileDownload(root, path.join(root, "escape.txt"), req).status, 403);
    assert.equal(workspaceFileDownload(root, root, req).status, 400);
    assert.equal(workspaceFileDownload(root, "missing.txt", req).status, 404);
    assert.equal(workspaceFileDownload(root, "", req).status, 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
