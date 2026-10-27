import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { estimateContextTokens } from "../lib/context-window";
import { compactChatPageMessages } from "../lib/chat-page-payload";
import { canvasFromToolPayload, layoutAssistantParts, memoryCardFromPayload, mergeChatMessages, planFromToolPayload } from "../lib/tool-call-display";
import { reconcileMessageParts } from "../lib/message-parts";
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
    const preview=compactChatPageMessages([card], "chat")[0].tools![0];
    assert.ok(preview.resultUrl);
    assert.ok(preview.result!.length<2048);
    assert.equal(card.tools![0].result,result);
  }
  const small = { ...message, tools: [{ ...message.tools![0], result: "small" }], parts: undefined };
  assert.equal(compactChatPageMessages([small], "chat")[0].tools![0].resultUrl, undefined);
  const encoded = compactChatPageMessages([{ ...message, id: "a&b" }], "a/b")[0].tools![0].resultUrl!;
  assert.equal(new URL(encoded, "http://test").searchParams.get("messageId"), "a&b");
  assert.match(encoded, /a%2Fb/);
});


test("deferred workspace mutations preserve saved identities and bounded valid content in tools and parts", () => {
  for (const type of ["plan", "canvas"] as const) {
    for (const action of ["create", "edit"]) {
      const saved = {
        content: "Stored document ".repeat(5_000) + "FULL_DOCUMENT_END",
        id: `saved-${type}`, type, name: "Saved title", workspaceLink: `workspace://${type}/saved-${type}`,
      };
      const tool = {
        id: `tool-${action}-${type}`, name: `mcp__metis_ai__${action}_${type}`, kind: type, status: "completed",
        input: JSON.stringify({ id: "submitted-id", title: "Submitted title", content: "Submitted ".repeat(5_000) }),
        result: JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify(saved) }] } }),
      };
      const source: ChatMessage = { ...message, tools: [tool], parts: [{ type: "tool", ...tool }] };
      const original = JSON.stringify(source);
      const compact = compactChatPageMessages([source], "chat")[0];
      const preview = compact.tools![0];
      const summary = JSON.parse(preview.result!);
      assert.equal(summary.id, saved.id);
      assert.equal(summary.name, saved.name);
      assert.equal(summary.workspaceLink, saved.workspaceLink);
      assert.equal(summary.content, saved.content.slice(0, 256));
      assert.ok(preview.result!.length < 2_048);
      assert.ok(preview.inputUrl);
      assert.ok(preview.resultUrl);
      assert.ok(!preview.result!.includes("FULL_DOCUMENT_END"));
      const parsed = type === "plan" ? planFromToolPayload(preview.input, preview.result) : canvasFromToolPayload(preview.input, preview.result);
      assert.equal(parsed?.workspaceLink, saved.workspaceLink);
      assert.equal(parsed?.title, saved.name);
      assert.equal(compact.parts![0].type === "tool" && compact.parts![0].result, preview.result);
      assert.equal(JSON.stringify(source), original);
    }
  }
});

test("deferred memory mutations retain stored scope, identity and text through provider envelopes", () => {
  for (const envelope of ["content", "structuredContent", "structured_content"]) {
    for (const action of ["add_memory", "edit_memory"]) {
      const saved = { scope: "chat", memory: { id: "stored-memory", title: "Stored fact", content: "Stored fact ".repeat(5_000) } };
      const payload = envelope === "content"
        ? { content: [{ type: "text", text: JSON.stringify(saved) }] }
        : { [envelope]: saved };
      const source: ChatMessage = {
        ...message, parts: undefined,
        tools: [{
          id: "memory-tool", name: "call_mcp_tool", kind: "mcp", status: "completed",
          input: JSON.stringify({ toolName: action, arguments: { scope: "global", content: "Submitted fact" } }),
          result: JSON.stringify(payload),
        }],
      };
      const preview = compactChatPageMessages([source], "chat")[0].tools![0];
      const summary = JSON.parse(preview.result!);
      assert.equal(summary.scope, "chat");
      assert.equal(summary.memory.id, "stored-memory");
      assert.equal(summary.memory.title, "Stored fact");
      assert.equal(summary.memory.content, saved.memory.content.slice(0, 256).trim());
      assert.deepEqual(memoryCardFromPayload(preview.name, preview.input, preview.result, preview.status), {
        title: action === "add_memory" ? "Saved Chat Memory" : "Updated Chat Memory",
        body: saved.memory.content.slice(0, 256).trim(),
      });
      assert.ok(preview.result!.length < 2_048);
      assert.ok(preview.resultUrl);
    }
  }
});

test("deferred failed mutations preserve error flags without exposing a saved identity", () => {
  for (const failure of [
    { isError: true, content: [{ type: "text", text: JSON.stringify({ id: "unsafe-id", content: "x".repeat(5_000) }) }] },
    { structuredContent: { success: false, error: "Storage rejected", padding: "x".repeat(5_000) } },
    { structured_content: { status: "failed", error: { message: "Provider rejected" }, padding: "x".repeat(5_000) } },
    { ok: false, padding: "x".repeat(5_000) },
  ]) {
    const tool = { id: "failed-tool", name: "create_plan", kind: "plan" as const, status: "completed", input: '{"id":"submitted-id","content":"Draft"}', result: JSON.stringify(failure) };
    const preview = compactChatPageMessages([{ ...message, tools: [tool], parts: undefined }], "chat")[0].tools![0];
    const summary = JSON.parse(preview.result!);
    assert.equal(summary.isError, true);
    assert.equal(typeof summary.error, "string");
    assert.equal(summary.id, undefined);
    assert.equal(summary.workspaceLink, undefined);
    assert.ok(preview.resultUrl);
    assert.ok(preview.result!.length < 2_048);
  }
  const failed = compactChatPageMessages([{
    ...message, parts: undefined,
    tools: [{ id: "failed-status", name: "edit_canvas", kind: "canvas", status: "error", result: JSON.stringify({ id: "unsafe-id", content: "x".repeat(5_000) }) }],
  }], "chat")[0].tools![0];
  assert.equal(JSON.parse(failed.result!).isError, true);
  assert.equal(JSON.parse(failed.result!).id, undefined);
  const nestedMemory = compactChatPageMessages([{
    ...message, parts: undefined,
    tools: [{ id: "failed-memory", name: "add_memory", kind: "memory", status: "completed", result: JSON.stringify({ memory: { id: "unsafe-id", scope: "project", error: "Memory rejected", content: "x".repeat(5_000) } }) }],
  }], "chat")[0].tools![0];
  assert.deepEqual(JSON.parse(nestedMemory.result!), { isError: true, error: "Memory rejected", scope: "project" });
});

test("mutation compaction never promotes submitted identities or adds bulk", () => {
  const input = JSON.stringify({ id: "submitted-id", content: "Submitted ".repeat(5_000) });
  const inputOnly = compactChatPageMessages([{
    ...message, parts: undefined, tools: [{ id: "input-only", name: "create_plan", kind: "plan", status: "completed", input }],
  }], "chat")[0].tools![0];
  assert.equal(inputOnly.result, undefined);
  assert.equal(inputOnly.resultUrl, undefined);
  assert.ok(inputOnly.inputUrl);
  const noIdentity = compactChatPageMessages([{
    ...message, parts: undefined, tools: [{ ...inputOnly, result: JSON.stringify({ padding: "x".repeat(5_000) }) }],
  }], "chat")[0].tools![0];
  assert.ok(!noIdentity.result!.includes("submitted-id"));
  const escaped = compactChatPageMessages([{
    ...message, parts: undefined,
    tools: [{ id: "escaped", name: "add_memory", kind: "memory", status: "completed", result: JSON.stringify({ scope: "project", memory: { id: "stored-id", content: "\u0001".repeat(5_000), title: "\u0002".repeat(5_000) } }) }],
  }], "chat")[0].tools![0];
  assert.equal(JSON.parse(escaped.result!).memory.id, "stored-id");
  assert.ok(escaped.result!.length < 2_048);
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
  const largeInput = JSON.stringify({ path: "large.txt", content: "original-input ".repeat(10_000) + "INPUT_END" });
  store.appendMessage(chat.id, { ...message, id: "input-only", tools: [{ ...message.tools![0], input: largeInput, result: undefined }], parts: undefined }, owner);
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
  const inputTool = page.chat.messages[2].tools[0];
  assert.equal(JSON.parse(inputTool.input).path, "large.txt");
  assert.ok(inputTool.input.length < 1_000);
  const originalInput = await resultRoute.GET(request(inputTool.inputUrl), params);
  assert.equal((await originalInput.json()).input, largeInput);
  assert.equal((await resultRoute.GET(request(inputTool.inputUrl, otherToken), params)).status, 404);
  assert.equal(store.getChat(chat.id, owner)!.messages[0].tools![0].result, result);
});


test("loading a full message keeps text between tool groups after pagination and later polls", async () => {
  const [{ getDatabase }, store, pageRoute, messageRoute] = await Promise.all([
    import("../lib/sqlite"), import("../lib/db-store"), import("../app/api/chats/[id]/route"),
    import("../app/api/chats/[id]/message/route"),
  ]);
  const db = getDatabase(), owner = randomUUID(), token = randomUUID();
  const stamp = new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(owner, owner, "unused", stamp);
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), owner, "2099-01-01T00:00:00.000Z");
  const chat = store.createChat("Interleaved activity", undefined, owner);
  const parts: NonNullable<ChatMessage["parts"]> = [{ type: "text", content: "Start. " }];
  for (let i = 0; i < 30; i++) {
    parts.push({ type: "tool", id: "read-" + i, name: "read_file", kind: "read", status: "completed", result });
    if (i === 9 || i === 19) parts.push({ type: "text", content: "Progress " + i + ". " });
  }
  parts.push({ type: "text", content: "Full answer. ".repeat(1500) });
  const content = parts.flatMap(part => part.type === "text" ? [part.content] : []).join("");
  store.appendMessage(chat.id, { id: "interleaved", role: "assistant", content, createdAt: stamp, parts }, owner);
  const params = { params: Promise.resolve({ id: chat.id }) };
  const request = (url: string) => new Request("http://fixture" + url, { headers: { cookie: "ai_chat_auth=" + token } });
  const page = await (await pageRoute.GET(request("/api/chats/" + chat.id), params)).json();
  const preview = page.chat.messages[0] as ChatMessage;
  assert.ok(preview.contentUrl);
  assert.ok(preview.eventOffset! > 0);
  const response = await messageRoute.GET(request(preview.contentUrl!), params);
  assert.equal(response.status, 200);
  const full = await response.json();
  assert.equal(full.content, content);
  assert.deepEqual(full.parts.map((part: { type: string }) => part.type), parts.map(part => part.type));
  assert.ok(JSON.stringify(full).length < 100_000, "tool outputs stay deferred");
  assert.ok(full.parts.find((part: { type: string }) => part.type === "tool").resultUrl);
  const expanded = { ...preview, ...full, eventsUrl: undefined, eventOffset: 0, contentUrl: undefined } as ChatMessage;
  const [afterPoll] = mergeChatMessages([expanded], [preview]);
  const ordered = reconcileMessageParts({ parts: afterPoll.parts, content: afterPoll.content, tools: afterPoll.tools });
  const blocks = layoutAssistantParts(ordered);
  assert.deepEqual(blocks.map(block => block.type), ["text", "tools", "text", "tools", "text", "tools", "text"]);
  assert.deepEqual(blocks.filter(block => block.type === "tools").map(block => block.tools.length), [10, 10, 10]);
  assert.equal(blocks.filter(block => block.type === "text").map(block => block.content).join(""), content);
  const stored = store.getChat(chat.id, owner)!.messages[0];
  assert.deepEqual(stored.parts, parts);
  const unauthenticated = await messageRoute.GET(new Request("http://fixture" + preview.contentUrl!), params);
  assert.equal(unauthenticated.status, 401);
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

test("pagination preserves order and refreshes caches on external revisions without leaking owners", async () => {
  const [{ getDatabase }, store] = await Promise.all([import("../lib/sqlite"), import("../lib/db-store")]);
  const db = getDatabase(), owner = randomUUID(), other = randomUUID();
  for (const id of [owner, other]) db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id, id, "unused", new Date().toISOString());
  const chat = store.createChat("Pagination", undefined, owner);
  for (let i = 0; i < 8; i++) store.appendMessage(chat.id, { role: "user", content: "message-" + i }, owner);
  store.clearStoreCaches();
  const last = store.getChatPage(chat.id, owner, 3, 0)!;
  assert.deepEqual(last.chat.messages.map(m => m.content), ["message-5", "message-6", "message-7"]);
  assert.equal(last.totalMessages, 8);
  assert.equal(last.hasEarlierMessages, true);
  assert.deepEqual(store.getChatPage(chat.id, owner, 3, 0), last);
  assert.deepEqual(store.getChatPage(chat.id, owner, 3, 3)!.chat.messages.map(m => m.content), ["message-2", "message-3", "message-4"]);
  assert.deepEqual(store.getChatPage(chat.id, owner, 3, 20)!.chat.messages, []);
  store.getChat(chat.id, owner);
  assert.equal(store.getChat(chat.id, other), null);
  assert.equal(store.getChatPage(chat.id, other, 3, 0), null);
  const revision = "2090-01-01T00:00:00.000Z";
  db.prepare("UPDATE chats SET data=json_set(data,'$.title','External edit'),updated_at=? WHERE id=?").run(revision, chat.id);
  assert.equal(store.getChat(chat.id, owner)!.title, "External edit");
  assert.equal(store.getChatPage(chat.id, owner, 3, 0)!.chat.title, "External edit");
  db.prepare("DELETE FROM chats WHERE id=?").run(chat.id);
  assert.equal(store.getChat(chat.id, owner), null);
  assert.equal(store.getChatPage(chat.id, owner, 3, 0), null);
});

test("large command arguments keep a valid caption and original context estimate", () => {
  const input = JSON.stringify({ command: "echo " + "example ".repeat(5_000), target: "server" });
  const m = { ...message, tools: [{ ...message.tools![0], name: "execute_command", kind: "shell" as const, input }], parts: undefined };
  const compact = compactChatPageMessages([m], "chat")[0];
  assert.equal(JSON.parse(compact.tools![0].input!).target, "server");
  assert.ok(compact.tools![0].inputUrl);
  assert.ok(compact.tools![0].resultUrl);
  assert.equal(compact.contextTokenEstimate, estimateContextTokens({ role: m.role, content: m.content, tools: m.tools }));
});
