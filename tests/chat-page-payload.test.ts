import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { estimateContextTokens } from "../lib/context-window";
import { compactChatPageMessages } from "../lib/chat-page-payload";
import type { ChatMessage } from "../lib/store";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-chat-payload-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AGENT_CWD = root;
test.after(() => rmSync(root, { recursive: true, force: true }));

const result = "large-output ".repeat(100_000) + "END_OF_FULL_OUTPUT";
const message: ChatMessage = {
  id: "message-id", role: "assistant", content: "The useful reply.", createdAt: new Date().toISOString(),
  tools: [{ id: "tool-id", name: "read_file", kind: "read", status: "completed", input: '{"path":"example.txt"}', result }],
  parts: [{ type: "tool", id: "tool-id", name: "read_file", kind: "read", status: "completed", result },
    { type: "text", content: "The useful reply." }],
};

test("large repeated outputs load on demand without modifying stored history or conversation text", () => {
  const original = JSON.stringify(message);
  const [compact] = compactChatPageMessages([message], "chat-id");
  assert.equal(compact.content, message.content);
  assert.equal(compact.contextTokenEstimate, estimateContextTokens({ role: message.role, content: message.content, tools: message.tools || [] }));
  assert.ok(JSON.stringify(compact).length < 3_500);
  assert.ok(JSON.stringify(message).length > 2_000_000);
  assert.equal(compact.tools![0].resultUrl, "/api/chats/chat-id/tool-result?messageId=message-id&toolId=tool-id");
  assert.equal(compact.parts![0].type === "tool" && compact.parts![0].result, compact.tools![0].result);
  assert.equal(JSON.stringify(message), original);
});

test("structured cards, small outputs and special-character IDs retain their behavior", () => {
  for (const kind of ["plan", "canvas", "note", "memory", "automation", "todo", "subagent"] as const) {
    const card: ChatMessage = { ...message, tools: [{ ...message.tools![0], kind }], parts: undefined };
    assert.equal(compactChatPageMessages([card], "chat")[0].tools![0].result, result);
  }
  const small = { ...message, tools: [{ ...message.tools![0], result: "small" }], parts: undefined };
  assert.equal(compactChatPageMessages([small], "chat")[0].tools![0].resultUrl, undefined);
  const encoded = compactChatPageMessages([{ ...message, id: "a&b" }], "a/b")[0].tools![0].resultUrl!;
  assert.equal(new URL(encoded, "http://test").searchParams.get("messageId"), "a&b");
  assert.match(encoded, /a%2Fb/);
});

test("paged API returns compact tools and owner-only endpoint retrieves full tools and parts", async () => {
  const [{ getDatabase }, store, pageRoute, resultRoute] = await Promise.all([
    import("../lib/sqlite"), import("../lib/db-store"), import("../app/api/chats/[id]/route"),
    import("../app/api/chats/[id]/tool-result/route"),
  ]);
  const db = getDatabase(), owner = randomUUID(), other = randomUUID(), token = randomUUID(), otherToken = randomUUID();
  const now = new Date().toISOString();
  for (const [id, session] of [[owner, token], [other, otherToken]]) {
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id, id, "unused", now);
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(createHash("sha256").update(session).digest("hex"), id, "2099-01-01T00:00:00.000Z");
  }
  const chat = store.createChat("Large output fixture", undefined, owner);
  store.appendMessage(chat.id, message, owner);
  store.appendMessage(chat.id, { ...message, id: "parts-only", tools: undefined }, owner);
  const params = { params: Promise.resolve({ id: chat.id }) };
  const request = (url: string, session = token) => new Request("http://test" + url, { headers: { cookie: "ai_chat_auth=" + session } });
  const response = await pageRoute.GET(request("/api/chats/" + chat.id), params);
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.ok(JSON.stringify(page).length < 6_000);
  const url = page.chat.messages[0].tools[0].resultUrl;
  assert.equal((await resultRoute.GET(new Request("http://test" + url), params)).status, 401);
  assert.equal((await resultRoute.GET(request(url, otherToken), params)).status, 404);
  assert.equal((await resultRoute.GET(request(url.replace("message-id", "missing")), params)).status, 404);
  assert.equal((await resultRoute.GET(request("/api/chats/" + chat.id + "/tool-result"), params)).status, 400);
  const full = await resultRoute.GET(request(url), params);
  assert.equal(full.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await full.json()).result, result);
  const partsUrl = page.chat.messages[1].parts[0].resultUrl;
  assert.equal((await (await resultRoute.GET(request(partsUrl), params)).json()).result, result);
  assert.equal(store.getChat(chat.id, owner)!.messages[0].tools![0].result, result);
});

test("queue lookup uses a partial index and stays current as queues are added and drained", async () => {
  const [{ getDatabase }, store] = await Promise.all([import("../lib/sqlite"), import("../lib/db-store")]);
  const db = getDatabase();
  const chat = store.createChat("Queue index fixture");
  assert.ok(!store.listChatsWithQueuedMessages().some(item => item.id === chat.id));
  store.updateChat(chat.id, { queuedMessages: [{ id: "queued", text: "Continue" }] });
  assert.ok(store.listChatsWithQueuedMessages().some(item => item.id === chat.id));
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT data FROM chats
    WHERE json_type(data, '$.queuedMessages') = 'array'
      AND json_array_length(json_extract(data, '$.queuedMessages')) > 0
    ORDER BY updated_at ASC`).all();
  assert.match(JSON.stringify(plan), /USING INDEX chats_pending_queue/);
  store.updateChat(chat.id, { queuedMessages: [] });
  assert.ok(!store.listChatsWithQueuedMessages().some(item => item.id === chat.id));
});
