import assert from "node:assert/strict";
import test from "node:test";
import { fileEntryNameError, parentFileDirectory, parseFileListing } from "../lib/file-editor";

test("file listing keeps names with spaces, dots and arrow text and sorts folders first", () => {
  const output = [
    "total 12",
    "drwxr-xr-x 2 root root 4096 2026-10-13 20:00 .",
    "drwxr-xr-x 3 root root 4096 2026-10-13 20:00 ..",
    "-rw-r--r-- 1 root root 3 2026-10-13 20:00 Größe -> test.yml",
    "drwxr-xr-x 2 root root 4096 2026-10-13 20:00 plugins",
    "-rw-r--r-- 1 root root 0 2026-10-13 20:00 .env",
    "lrwxrwxrwx 1 root root 7 2026-10-13 20:00 linked -> outside",
  ].join("\n");
  assert.deepEqual(parseFileListing(output, "/workspace/").map(e => [e.name, e.path, e.directory]), [
    ["plugins", "/workspace/plugins", true], [".env", "/workspace/.env", false], ["Größe -> test.yml", "/workspace/Größe -> test.yml", false],
  ]);
});
test("entry names accept Unicode and spaces but prevent path traversal and control characters", () => {
  for (const name of ["", " ", ".", "..", "../file", "/root", "a/b", "a\\b", "a\0b", "a\nb", "ä".repeat(128)]) assert.ok(fileEntryNameError(name), name);
  for (const name of ["server.properties", ".env", "Neuer Ordner", "Größe.yml", "a'b;$().txt"]) assert.equal(fileEntryNameError(name), "");
});
test("parent navigation handles root and trailing slashes", () => {
  assert.equal(parentFileDirectory("/workspace/plugins/"), "/workspace");
  assert.equal(parentFileDirectory("/workspace"), "/");
  assert.equal(parentFileDirectory("/"), "/");
});
