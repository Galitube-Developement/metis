import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("plan and canvas saves preserve rich Markdown exactly and reject overflow without changing the saved version", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-workspace-editor-"));
  Object.assign(process.env, {
    AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
    AGENT_CWD: root, METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
  });
  const { createUser, authenticateUser } = await import("../lib/auth");
  const { getDatabase } = await import("../lib/sqlite");
  const { createChat, saveChat, getChat } = await import("../lib/db-store");
  const { PATCH, GET } = await import("../app/api/workspaces/route");
  const owner = createUser("workspace-editor-owner", "test-password");
  createUser("workspace-editor-other", "test-password");
  const token = authenticateUser("workspace-editor-owner", "test-password")!.token;
  const foreignToken = authenticateUser("workspace-editor-other", "test-password")!.token;
  const chat = createChat("Editor fixtures", undefined, owner.id);
  const time = new Date().toISOString();
  chat.workspaces = (["plan", "canvas"] as const).map(type => ({
    id: type + "-fixture", type, name: type, content: "Previously saved", version: 1, createdAt: time, updatedAt: time,
  }));
  saveChat(chat);
  const request = (body: unknown, authToken: string | null = token) => new Request("http://localhost/api/workspaces", {
    method: "PATCH", headers: { "Content-Type": "application/json", ...(authToken ? { cookie: "ai_chat_auth=" + authToken } : {}) },
    body: JSON.stringify(body),
  });
  const saved = (id: string) => getChat(chat.id, owner.id)!.workspaces!.find(item => item.id === id)!;
  const rich = '---\r\nname: preserved\r\n---\r\n\r\n# Heading\n\n- [ ] Task\n\n~~~metis-block\n{"version":1,"type":"callout","content":[{"type":"paragraph","content":[{"type":"text","text":"Keep me"}]}]}\n~~~';
  try {
    for (const type of ["plan", "canvas"]) {
      const id = type + "-fixture";
      const update = { chatId: chat.id, id, version: 1, content: rich };
      assert.equal((await PATCH(request(update, null))).status, 401);
      assert.equal((await PATCH(request(update, foreignToken))).status, 404);
      const atLimit = "x".repeat(100_000 - rich.length) + rich;
      const overflow = await PATCH(request({ ...update, content: "x" + atLimit }));
      assert.equal(overflow.status, 413);
      assert.match((await overflow.json()).error, /100,000/);
      assert.equal(saved(id).content, "Previously saved");
      assert.equal(saved(id).version, 1);
      const response = await PATCH(request({ ...update, content: atLimit }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).workspace.content, atLimit);
      assert.equal(saved(id).content, atLimit);
      assert.equal(saved(id).version, 2);
      const conflict = await PATCH(request(update));
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).workspace.content, atLimit);
      const read = await GET(new Request("http://localhost/api/workspaces?chatId=" + chat.id + "&id=" + id, {
        headers: { cookie: "ai_chat_auth=" + token },
      }));
      assert.equal(read.status, 200);
      assert.equal((await read.json()).workspace.content, atLimit);
    }
  } finally {
    getDatabase().close();
    rmSync(root, { recursive: true, force: true });
  }
});
