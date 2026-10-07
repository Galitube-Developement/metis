import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-provided-files-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AGENT_CWD = root;
process.env.MCP_BEARER_TOKEN = "local-file-test";
test.after(() => rmSync(root, { recursive: true, force: true }));

async function fixture() {
  const { getDatabase } = await import("../lib/sqlite");
  const { createChat, appendMessage } = await import("../lib/db-store");
  const { enqueueJob, claimNextJob, appendRunEvent } = await import("../lib/db-jobs");
  const owner = randomUUID(), other = randomUUID();
  const token = randomUUID(), otherToken = randomUUID();
  const db = getDatabase();
  for (const [id, session] of [[owner, token], [other, otherToken]]) {
    db.prepare("INSERT INTO users(id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(id, id, "unused", new Date().toISOString());
    db.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(createHash("sha256").update(session).digest("hex"), id, "2099-01-01T00:00:00.000Z");
  }
  const chat = createChat("Files", undefined, owner);
  const job = enqueueJob({ chatId: chat.id, userId: owner, message: "Share a file" });
  const claimed = claimNextJob({ workerId: randomUUID() })!;
  assert.equal(claimed.id, job.id);
  const messageId = randomUUID();
  appendMessage(chat.id, { id: messageId, role: "assistant", content: "" }, owner);
  appendRunEvent(job.id, chat.id, owner, "assistantId", { messageId });
  return { owner, other, token, otherToken, chat, job, claimed, messageId };
}

test("provide_file registers bytes before returning a URL without relying on provider tool results", async () => {
  const f = await fixture();
  const { getUserAgentCwd } = await import("../lib/mcp");
  const { POST } = await import("../app/api/internal/mcp-file/route");
  const { GET } = await import("../app/api/uploads/[chatId]/[name]/route");
  const { getChat, upsertMessage } = await import("../lib/db-store");
  const file = path.join(getUserAgentCwd(f.owner), "result.png");
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=", "base64");
  writeFileSync(file, bytes);
  const response = await POST(new Request("http://test/api/internal/mcp-file", {
    method: "POST",
    headers: { authorization: "Bearer local-file-test", "Content-Type": "application/json", "x-ai-chat-id": f.chat.id, "x-ai-chat-user-id": f.owner, "x-ai-chat-job-id": f.job.id, "x-ai-chat-worker-id": f.claimed.leaseOwner!, "x-ai-chat-lease-token": f.claimed.leaseToken! },
    body: JSON.stringify({ path: file }),
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(getChat(f.chat.id, f.owner)!.messages[0].attachments?.[0].id, result.attachment.id);
  const context = { params: Promise.resolve({ chatId: f.chat.id, name: result.attachment.storedName }) };
  const req = (session?: string) => new Request("http://test" + result.downloadUrl, { headers: session ? { cookie: "ai_chat_auth=" + session } : {} });
  assert.equal((await GET(req(), context)).status, 401);
  assert.equal((await GET(req(f.otherToken), context)).status, 404);
  const download = await GET(req(f.token), context);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  // A provider checkpoint that lacks attachment telemetry must retain the file.
  upsertMessage(f.chat.id, { id: f.messageId, role: "assistant", content: result.markdown });
  const after = await GET(req(f.token), context);
  assert.equal(after.status, 200);
  await after.arrayBuffer();
});

test("registration follows the run's exact assistant message and survives partial checkpoints", async () => {
  const f = await fixture();
  const { registerProvidedFile } = await import("../lib/provided-files");
  const { getChat, appendMessage, upsertMessage } = await import("../lib/db-store");
  const lateMessage = randomUUID();
  appendMessage(f.chat.id, { id: lateMessage, role: "assistant", content: "Unrelated message" }, f.owner);
  const first = { id: randomUUID(), name: "first.txt", mimeType: "text/plain", kind: "file" as const, storedName: "first.txt", size: 1 };
  const second = { ...first, id: randomUUID(), name: "second.txt", storedName: "second.txt" };
  registerProvidedFile(f.chat.id, f.job.id, f.owner, first);
  registerProvidedFile(f.chat.id, f.job.id, f.owner, first);
  registerProvidedFile(f.chat.id, f.job.id, f.owner, second);
  upsertMessage(f.chat.id, { id: f.messageId, role: "assistant", content: "Done", attachments: [first] });
  const messages = getChat(f.chat.id, f.owner)!.messages;
  assert.deepEqual(messages.find(m => m.id === f.messageId)!.attachments, [first, second]);
  assert.equal(messages.find(m => m.id === lateMessage)!.attachments, undefined);
});

test("foreign owners, mismatched chats and absent run messages cannot register files", async () => {
  const f = await fixture();
  const { registerProvidedFile } = await import("../lib/provided-files");
  const { createChat, getChat } = await import("../lib/db-store");
  const empty = createChat("Empty", undefined, f.owner);
  const attachment = { id: randomUUID(), name: "x.txt", mimeType: "text/plain", kind: "file" as const, storedName: "x.txt", size: 1 };
  assert.throws(() => registerProvidedFile(f.chat.id, f.job.id, f.other, attachment), /could not be found/);
  assert.throws(() => registerProvidedFile(empty.id, f.job.id, f.owner, attachment), /could not be found/);
  assert.throws(() => registerProvidedFile(f.chat.id, randomUUID(), f.owner, attachment), /could not be found/);
  assert.equal(getChat(f.chat.id, f.owner)!.messages[0].attachments, undefined);
});
