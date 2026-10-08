import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { currentChatTodos, newerChatTodos } from "../lib/chat-todos";
import type { ChatMessage, ToolPart } from "../lib/store";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-chat-todos-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AGENT_CWD = root;
test.after(() => rmSync(root, { recursive: true, force: true }));

const tool = (id: string, content: string, status = "completed"): ToolPart => ({
  id, name: "write_todos", kind: "todo", status,
  input: JSON.stringify({ todos: [{ id: "one", content, status: "in_progress" }] }),
});
const message = (id: string, tools: ToolPart[], date = "2026-10-07T10:00:00Z"): ChatMessage => ({
  id, role: "assistant", createdAt: date, content: "", tools,
});

test("latest successful list wins; failed and in-flight requests never replace it", () => {
  const history = [message("one", [tool("old", "First")]), message("two", [tool("failed", "Wrong", "error"), tool("pending", "Not confirmed", "running")])];
  assert.equal(currentChatTodos(history)?.items[0].content, "First");
  history[1].tools!.push({ ...tool("wrapped-error", "Wrong"), result: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ isError: true, error: "failed" }) }] }) });
  assert.equal(currentChatTodos(history)?.toolId, "old");
});

test("normalized parts override duplicate tools and confirmed empty lists clear tasks", () => {
  const original = tool("same", "Input");
  const part = { ...original, type: "tool" as const, result: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ todos: [{ content: "Saved", status: "done" }] }) }] }) };
  assert.equal(currentChatTodos([{ ...message("m", [original]), parts: [part] }])?.items[0].content, "Saved");
  assert.equal(currentChatTodos([{ ...message("m", [original]), parts: [{ ...part, result: '{"todos":[]}' }] }])?.items.length, 0);
});

test("reverting to earlier history restores its list; live updates beat older paginated baseline", () => {
  const first = message("one", [tool("first", "First")], "2026-10-07T09:00:00Z");
  const second = message("two", [tool("second", "Second")]);
  const saved = currentChatTodos([first]);
  assert.equal(newerChatTodos(currentChatTodos([first, second]), saved)?.toolId, "second");
  assert.equal(currentChatTodos([first])?.toolId, "first");
  assert.equal(newerChatTodos(null, saved)?.toolId, "first");
});

test("owner-scoped projection finds tasks outside the loaded page and clears after revert", async () => {
  const [{ getDatabase }, store, todosRoute] = await Promise.all([
    import("../lib/sqlite"), import("../lib/db-store"), import("../app/api/chats/[id]/todos/route"),
  ]);
  const db = getDatabase(), owner = randomUUID(), other = randomUUID(), token = randomUUID(), otherToken = randomUUID();
  const now = new Date().toISOString();
  for (const [id, session] of [[owner, token], [other, otherToken]]) {
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id, id, "unused", now);
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(createHash("sha256").update(session).digest("hex"), id, "2099-01-01T00:00:00.000Z");
  }
  const chat = store.createChat("Tasks fixture", undefined, owner);
  store.appendMessage(chat.id, message("todo", [tool("saved", "Outside page")]), owner);
  for (let i = 0; i < 15; i++) store.appendMessage(chat.id, message("later-" + i, []), owner);
  const page = store.getChatPage(chat.id, owner, 1, 0)!;
  assert.equal(page.chat.messages.length, 1);
  assert.equal(page.currentTodos?.items[0].content, "Outside page");
  const request = (session: string) => new Request("http://test/api/chats/" + chat.id + "/todos", { headers: { cookie: "ai_chat_auth=" + session } });
  const response = await todosRoute.GET(request(token), { params: Promise.resolve({ id: chat.id }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).currentTodos.toolId, "saved");
  assert.equal((await todosRoute.GET(request(otherToken), { params: Promise.resolve({ id: chat.id }) })).status, 404);
  assert.equal((await todosRoute.GET(new Request("http://test"), { params: Promise.resolve({ id: chat.id }) })).status, 401);
  store.saveChat({ ...store.getChat(chat.id, owner)!, messages: [] });
  assert.equal(store.getChatPage(chat.id, owner, 1, 0)?.currentTodos, null);
});
