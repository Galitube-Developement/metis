import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const root = mkdtempSync(path.join(os.tmpdir(), "metis-chunk-uploads-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AGENT_CWD = root;
const modules = import("../lib/file-upload-store");
test.after(async () => { await rm(root, { recursive: true, force: true }); });
function bytes(data: Uint8Array) { return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } }); }
test("1 GB uploads stream in bounded chunks, attach without copying into memory, and have bounded text previews", async () => {
  const { createUpload, appendUpload, completeUpload, materializeUploads, uploadedFileResponse } = await modules;
  const { MAX_FILE_BYTES, UPLOAD_CHUNK_BYTES } = await import("../lib/upload-limits");
  const { resolveUploadPath, buildAttachmentPrompt } = await import("../lib/uploads");
  assert.throws(() => createUpload("one", { name: "too-big", mimeType: "text/plain", size: MAX_FILE_BYTES + 1 }), /1 GB/);
  const upload = createUpload("one", { name: "large.txt", mimeType: "text/plain", size: MAX_FILE_BYTES });
  const chunk = new Uint8Array(UPLOAD_CHUNK_BYTES).fill(65);
  for (let offset = 0; offset < MAX_FILE_BYTES; offset += chunk.byteLength) {
    const saved = await appendUpload("one", upload.id, offset, bytes(chunk));
    assert.equal(saved.offset, offset + chunk.byteLength);
  }
  assert.equal(completeUpload("one", upload.id).size, MAX_FILE_BYTES);
  const stored = materializeUploads("test-chat", [upload.id], "one");
  assert.equal(statSync(resolveUploadPath("test-chat", stored[0].storedName, "one")!).size, MAX_FILE_BYTES);
  const preview = buildAttachmentPrompt("test-chat", stored, "one");
  assert.ok(preview.length < 81_000);
  assert.match(preview, /preview truncated/);
  const response = uploadedFileResponse("one", upload.id);
  assert.equal(response.headers.get("Content-Length"), String(MAX_FILE_BYTES));
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.ok(first.value!.length <= 128 * 1024);
  await reader.cancel();
});
test("offset failures and oversized chunks roll back, incomplete and foreign uploads cannot be used", async () => {
  const { createUpload, appendUpload, getUpload, getCompletedUpload, completeUpload } = await modules;
  const upload = createUpload("alice", { name: "photo.png", mimeType: "image/png", size: 8 });
  assert.throws(() => getUpload("bob", upload.id), /not found/);
  assert.throws(() => getUpload("alice", "../outside"), /not found/);
  assert.throws(() => getCompletedUpload("alice", upload.id), /not complete/);
  await assert.rejects(appendUpload("alice", upload.id, 1, bytes(new Uint8Array([1]))), /offset/);
  await assert.rejects(appendUpload("alice", upload.id, 0, bytes(new Uint8Array(9))), /limit/);
  assert.equal(getUpload("alice", upload.id).offset, 0);
  await appendUpload("alice", upload.id, 0, bytes(new Uint8Array([1,2,3,4])));
  await assert.rejects(appendUpload("alice", upload.id, 0, bytes(new Uint8Array([5]))), /offset/);
  assert.throws(() => completeUpload("alice", upload.id), /not complete/);
  await appendUpload("alice", upload.id, 4, bytes(new Uint8Array([5,6,7,8])));
  assert.equal(completeUpload("alice", upload.id).kind, "image");
});
test("authenticated APIs protect upload status, bytes and media notes; resizing retains canonical media identity", async () => {
  const { getDatabase } = await import("../lib/sqlite");
  const { createUpload, appendUpload, completeUpload } = await modules;
  const { POST: initialize } = await import("../app/api/file-uploads/route");
  const { GET, PUT } = await import("../app/api/file-uploads/[id]/route");
  const { GET: download } = await import("../app/api/file-uploads/[id]/file/route");
  const { createNote, updateNote, getNote } = await import("../lib/shared-context");
  const db = getDatabase(), owner = randomUUID(), other = randomUUID();
  const token = randomUUID(), otherToken = randomUUID();
  for (const [id, session] of [[owner, token], [other, otherToken]]) {
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(id,id,"unused",new Date().toISOString());
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(createHash("sha256").update(session).digest("hex"),id,new Date(Date.now()+60_000).toISOString());
  }
  const upload = createUpload(owner, { name: "image.png", mimeType: "image/png", size: 4 });
  const context = { params: Promise.resolve({ id: upload.id }) };
  assert.equal((await initialize(new Request("http://test", { method: "POST" }))).status,401);
  assert.equal((await GET(new Request("http://test"),context)).status,401);
  const foreign = new Request("http://test",{ headers: { cookie: "ai_chat_auth="+otherToken } });
  assert.equal((await GET(foreign,context)).status,404);
  assert.equal((await download(foreign,context)).status,404);
  assert.throws(() => createNote({ownerId:owner,kind:"image",uploadId:upload.id}),/not complete/);
  const put = new Request("http://test",{ method:"PUT",headers:{cookie:"ai_chat_auth="+token,"Upload-Offset":"0"},body:new Uint8Array([137,80,78,71]) });
  assert.equal((await PUT(put,context)).status,200);
  completeUpload(owner,upload.id);
  const note = createNote({ownerId:owner,kind:"image",uploadId:upload.id,position:{x:10,y:20},size:{width:360,height:280},idempotencyKey:"unique"});
  const resized = updateNote(note.id,{ownerId:owner,position:{x:200,y:80},size:{width:500,height:400}})!;
  assert.equal(resized.asset?.id,upload.id);
  assert.equal(resized.kind,"image");
  assert.deepEqual(resized.size,{width:500,height:400});
  assert.equal(createNote({ownerId:owner,uploadId:upload.id,idempotencyKey:"unique"}).id,note.id);
  assert.equal(getNote(note.id,other),null);
  assert.throws(()=>createNote({ownerId:other,kind:"file",uploadId:upload.id}),/not found/);
  const result=await download(new Request("http://test",{headers:{cookie:"ai_chat_auth="+token}}),context);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()),new Uint8Array([137,80,78,71]));
});
