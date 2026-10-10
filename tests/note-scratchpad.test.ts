import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const root = mkdtempSync(path.join(os.tmpdir(), "metis-note-attachments-"));
process.env.AGENT_CWD = root;
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
const attachmentsModule = import("../lib/note-attachments");
test.after(async () => { await rm(root, { recursive: true, force: true }); });
import { noteAttachmentMarkdown } from "../lib/note-scratchpad";

test("scratchpad links render images and escape filenames without injecting Markdown", () => {
  assert.equal(noteAttachmentMarkdown([
    { name: "screen[1].png", kind: "image", url: "/api/notes/n/attachments/a" },
    { name: "notes.txt", kind: "file", url: "/api/notes/n/attachments/b" },
  ]), "![screen\\[1\\].png](/api/notes/n/attachments/a)\n\n[notes.txt](/api/notes/n/attachments/b)");
});

test("attachment endpoints enforce authentication and note ownership", async () => {
  const { getDatabase } = await import("../lib/sqlite");
  const { createNote } = await import("../lib/shared-context");
  const { POST } = await import("../app/api/notes/[id]/attachments/route");
  const { GET } = await import("../app/api/notes/[id]/attachments/[attachmentId]/route");
  const db = getDatabase();
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const ownerToken = randomUUID();
  const otherToken = randomUUID();
  for (const [id, token] of [[ownerId, ownerToken], [otherId, otherToken]]) {
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(id, id, "unused", new Date().toISOString());
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(createHash("sha256").update(token).digest("hex"), id, new Date(Date.now() + 60000).toISOString());
  }
  const { GET: listNotes } = await import("../app/api/notes/route");
  const emptyList = await listNotes(new Request("http://localhost/api/notes", { headers: { cookie: "ai_chat_auth=" + ownerToken } }));
  assert.equal(emptyList.status, 200);
  assert.deepEqual(await emptyList.json(), { notes: [], ownerId });
  const note = createNote({ ownerId, content: "scratchpad" });
  const params = { params: Promise.resolve({ id: note.id }) };
  const fileParams = { params: Promise.resolve({ id: note.id, attachmentId: randomUUID() }) };
  assert.equal((await POST(new Request("http://localhost"), params)).status, 401);
  assert.equal((await GET(new Request("http://localhost"), fileParams)).status, 401);
  const otherRequest = new Request("http://localhost", { headers: { cookie: "ai_chat_auth=" + otherToken } });
  assert.equal((await POST(otherRequest, params)).status, 404);
  assert.equal((await GET(otherRequest, fileParams)).status, 404);
  const form = new FormData();
  form.append("files", new File(["saved document"], "report.html", { type: "text/html" }));
  const uploaded = await POST(new Request("http://localhost", { method: "POST", headers: { cookie: "ai_chat_auth=" + ownerToken }, body: form }), params);
  assert.equal(uploaded.status, 200);
  const body = await uploaded.json();
  const downloadParams = { params: Promise.resolve({ id: note.id, attachmentId: body.attachments[0].id }) };
  const download = await GET(new Request("http://localhost", { headers: { cookie: "ai_chat_auth=" + ownerToken } }), downloadParams);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "saved document");
  assert.match(download.headers.get("Content-Disposition") || "", /^attachment/);
  assert.equal(download.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal((await GET(otherRequest, downloadParams)).status, 404);
});

test("upload limits reject the whole batch before storage", async () => {
  const { validateNoteFiles } = await attachmentsModule;
  assert.throws(() => validateNoteFiles([]), /at least one/);
  assert.throws(() => validateNoteFiles([{ name: "empty", size: 0 }]), /empty/);
  assert.throws(() => validateNoteFiles([{ name: "large", size: 50 * 1024 * 1024 + 1 }]), /50 MB/);
  assert.throws(() => validateNoteFiles(Array.from({ length: 11 }, () => ({ name: "file", size: 1 }))), /10 files/);
  assert.doesNotThrow(() => validateNoteFiles([{ name: "valid", size: 50 * 1024 * 1024 }]));
});

test("attachments persist exact bytes and stay within their note namespace", async () => {
  const { readNoteFile, storeNoteFiles } = await attachmentsModule;
  {
    const files = [
      new File([new Uint8Array([137, 80, 78, 71])], "screen.png", { type: "image/png" }),
      new File(["document"], "report.html", { type: "text/html" }),
    ];
    const stored = await storeNoteFiles("first-note", files);
    const image = await readNoteFile("first-note", stored[0].id);
    assert.equal(image?.mimeType, "image/png");
    assert.deepEqual(image?.data, Buffer.from([137, 80, 78, 71]));
    const document = await readNoteFile("first-note", stored[1].id);
    assert.equal(document?.data.toString(), "document");
    assert.equal(document?.kind, "file");
    assert.equal(document?.mimeType, "application/octet-stream");
    assert.equal(await readNoteFile("second-note", stored[0].id), null);
    assert.equal(await readNoteFile("first-note", "../../outside"), null);
    assert.equal(await readNoteFile("first-note", stored[0].id + ".json"), null);
    assert.match(stored[0].url, /^\/api\/notes\/first-note\/attachments\//);
  }
});

test("scratchpad names preserve ordinary letters and replace actual line breaks", () => {
  assert.equal(noteAttachmentMarkdown([{ name: "report.txt", kind: "file", url: "/file" }]), "[report.txt](/file)");
  assert.equal(noteAttachmentMarkdown([{ name: "line" + String.fromCharCode(10) + "break", kind: "file", url: "/file" }]), "[line break](/file)");
});
