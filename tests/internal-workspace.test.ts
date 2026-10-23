import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { WorkspaceItem } from "../lib/store";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-internal-workspace-"));
Object.assign(process.env, {
  AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AGENT_CWD: root, METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
});

const modulesPromise = Promise.all([
  import("../lib/auth"),
  import("../lib/db-store"),
  import("../lib/sqlite"),
  import("../lib/internal-workspace.server"),
  import("../app/api/internal-workspace/route"),
]);
let modules: Awaited<typeof modulesPromise>;
let token = "", foreignToken = "", ownerId = "", foreignOwnerId = "";
let sourceChatId = "", emptyChatId = "", foreignChatId = "";
const planId = "linked-plan", canvasId = "linked-canvas";
const now = new Date().toISOString();
const plan: WorkspaceItem = {
  id: planId, type: "plan", name: "Linked plan", content: "# Plan\n- [ ] Complete",
  createdAt: now, updatedAt: now, version: 4, scope: "chat",
};
const canvas: WorkspaceItem = {
  id: canvasId, type: "canvas", name: "Linked canvas", content: "# Canvas content",
  createdAt: now, updatedAt: now,
};

before(async () => {
  modules = await modulesPromise;
  const [{ createUser, authenticateUser }, { createChat, saveChat }] = modules;
  ownerId = createUser("workspace-owner", "test-password").id;
  foreignOwnerId = createUser("workspace-other", "test-password").id;
  token = authenticateUser("workspace-owner", "test-password")!.token;
  foreignToken = authenticateUser("workspace-other", "test-password")!.token;
  const source = createChat("Archived workspace source", undefined, ownerId);
  sourceChatId = source.id;
  source.archived = true;
  source.workspaces = [plan, canvas];
  saveChat(source);
  emptyChatId = createChat("Current chat without workspace", undefined, ownerId).id;
  const foreign = createChat("Other account workspace source", undefined, foreignOwnerId);
  foreignChatId = foreign.id;
  foreign.workspaces = [{ ...plan, content: "Private foreign content" }];
  saveChat(foreign);
});

after(() => {
  modules[2].getDatabase().close();
  rmSync(root, { recursive: true, force: true });
});

function request(kind: string | undefined, id: string | undefined, session = token, chatId?: string) {
  const params = new URLSearchParams();
  if (kind !== undefined) params.set("kind", kind);
  if (id !== undefined) params.set("id", id);
  if (chatId !== undefined) params.set("chatId", chatId);
  return new Request("http://localhost/api/internal-workspace?" + params, {
    headers: session ? { cookie: "ai_chat_auth=" + session } : {},
  });
}

async function resolve(kind: "plan" | "canvas", id: string, chatId?: string) {
  const response = await modules[4].GET(request(kind, id, token, chatId));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const data = await response.json() as { chatId: string; workspace: WorkspaceItem };
  assert.deepEqual(Object.keys(data).sort(), ["chatId", "workspace"]);
  return data;
}

async function unavailable(kind: string, id: string, chatId?: string, session = token) {
  const response = await modules[4].GET(request(kind, id, session, chatId));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "Workspace not found" });
}

test("workspace resolution authenticates and validates targets before lookup", async () => {
  const { GET } = modules[4];
  const response = await GET(request("plan", planId, ""));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  for (const [kind, id] of [
    [undefined, planId], ["plan", undefined], ["plan", ""], ["plan", "   "],
    ["note", planId], ["automation", planId], ["unknown", planId], ["plan", "x".repeat(201)],
    ["plan", "invalid/id"], ["canvas", "invalid\\id"], ["plan", "invalid\u0000id"],
  ]) {
    const invalid = await GET(request(kind, id));
    assert.equal(invalid.status, 400, String(kind) + ":" + String(id));
    assert.equal(invalid.headers.get("Cache-Control"), "private, no-store");
  }
  for (const chatId of ["", "   ", "x".repeat(201), "invalid/id", "invalid\\id", "invalid\u007fid"]) {
    assert.equal((await GET(request("plan", planId, token, chatId))).status, 400);
  }
});

test("unique owned workspaces resolve their actual chat and complete editor data", async () => {
  assert.deepEqual(await resolve("plan", planId), { chatId: sourceChatId, workspace: plan });
  assert.deepEqual(await resolve("canvas", canvasId), { chatId: sourceChatId, workspace: canvas });
  assert.deepEqual(await resolve("plan", planId, sourceChatId), { chatId: sourceChatId, workspace: plan });
  // A foreign account's repeated ID must not make an owned target ambiguous.
  const response = await modules[4].GET(request("plan", planId, foreignToken));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).chatId, foreignChatId);
});

test("an explicit missing or inaccessible chat never falls back to another matching chat", async () => {
  for (const chatId of [emptyChatId, foreignChatId, "missing-chat"]) {
    await unavailable("plan", planId, chatId);
  }
  await unavailable("plan", planId, sourceChatId, foreignToken);
  await unavailable("canvas", canvasId, undefined, foreignToken);
  await unavailable("plan", "missing-plan");
  await unavailable("canvas", planId, sourceChatId);
  await unavailable("plan", canvasId);
  assert.equal(modules[3].getInternalWorkspace({ kind: "plan", id: planId }, ""), null);
});

test("repeated IDs require the correct explicit chat and preserve target kind", async () => {
  const { createChat, saveChat } = modules[1];
  const first = createChat("First repeated workspace", undefined, ownerId);
  const second = createChat("Second repeated workspace", undefined, ownerId);
  for (const [chat, content] of [[first, "First"], [second, "Second"]] as const) {
    chat.workspaces = [
      { ...plan, id: "repeated-workspace", content: content + " plan" },
      { ...canvas, id: "repeated-workspace", content: content + " canvas" },
    ];
    saveChat(chat);
    assert.equal((await resolve("plan", "repeated-workspace", chat.id)).workspace.content, content + " plan");
    assert.equal((await resolve("canvas", "repeated-workspace", chat.id)).workspace.content, content + " canvas");
  }
  await unavailable("plan", "repeated-workspace");
  await unavailable("canvas", "repeated-workspace");
});

test("legacy canvases become usable editor workspaces without overriding explicit workspace lists", async () => {
  const { createChat, saveChat } = modules[1];
  const legacy = createChat("Legacy canvas source", undefined, ownerId);
  legacy.canvas = "# Legacy content";
  legacy.workspaces = [];
  saveChat(legacy);
  const expected = {
    chatId: legacy.id,
    workspace: {
      id: "canvas-default", type: "canvas", name: "Canvas", content: legacy.canvas,
      createdAt: legacy.createdAt, updatedAt: modules[1].getChat(legacy.id, ownerId)!.updatedAt,
    },
  };
  assert.deepEqual(await resolve("canvas", "canvas-default"), expected);
  assert.deepEqual(await resolve("canvas", "canvas-default", legacy.id), expected);
  const explicit = createChat("Explicit default canvas source", undefined, ownerId);
  explicit.canvas = "Hidden legacy content";
  explicit.workspaces = [{ ...canvas, id: "canvas-default" }];
  saveChat(explicit);
  await unavailable("canvas", "canvas-default");
  assert.equal((await resolve("canvas", "canvas-default", explicit.id)).workspace.content, canvas.content);

  const shadowed = createChat("Explicit other canvas source", undefined, ownerId);
  shadowed.canvas = "Hidden legacy content";
  shadowed.workspaces = [{ ...canvas, id: "other-explicit-canvas" }];
  saveChat(shadowed);
  await unavailable("canvas", "canvas-default", shadowed.id);
});

test("expired incognito workspaces remain unavailable with or without explicit context", async () => {
  const { createChat, saveChat } = modules[1];
  for (const explicit of [true, false]) {
    const chat = createChat("Expired private workspace", undefined, ownerId, undefined, { incognito: true });
    const id = explicit ? "expired-explicit-plan" : "expired-unique-plan";
    chat.workspaces = [{ ...plan, id }];
    chat.expiresAt = new Date(Date.now() - 60_000).toISOString();
    saveChat(chat);
    await unavailable("plan", id, explicit ? chat.id : undefined);
  }
});
