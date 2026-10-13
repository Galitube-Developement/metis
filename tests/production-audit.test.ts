import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { requestClientAddress } from "../lib/rate-limit";
import { CHAT_LIST_POLL_ACTIVE_MS, CHAT_LIST_POLL_IDLE_MS } from "../lib/chat-list-poll";

const dataDir = path.join(os.tmpdir(), `metis-prod-audit-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
process.env.CHAT_PASSWORD = "";

const modulesPromise = Promise.all([
  import("../lib/db-store"),
  import("../lib/sqlite"),
]);
let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("getChatByShareId looks up by share.id without scanning every chat blob", () => {
  const { createChat, updateChatShare, getChatByShareId } = modules[0];
  const decoy = createChat("Decoy");
  const shared = createChat("Shared");
  const updated = updateChatShare(shared.id, { active: true });
  assert.ok(updated?.share?.id);
  const found = getChatByShareId(updated.share.id);
  assert.equal(found.status, "ok");
  if (found.status === "ok") {
    assert.equal(found.chat.id, shared.id);
    assert.notEqual(found.chat.id, decoy.id);
  }
  assert.equal(getChatByShareId("missing-share").status, "not_found");
});

test("incognito chats are excluded from the normal chat list", () => {
  const { createChat, listChatsForUser } = modules[0];
  const visible = createChat("Visible");
  const hidden = createChat("Secret", undefined, undefined, undefined, { incognito: true });
  const listed = listChatsForUser();
  assert.equal(listed.some((chat) => chat.id === visible.id), true);
  assert.equal(listed.some((chat) => chat.id === hidden.id), false);
});

test("nested transaction() uses a savepoint instead of throwing", () => {
  const { transaction, getDatabase } = modules[1];
  const value = transaction(() => {
    getDatabase().exec("CREATE TABLE IF NOT EXISTS audit_nest (id INTEGER)");
    return transaction(() => {
      getDatabase().prepare("INSERT INTO audit_nest (id) VALUES (?)").run(1);
      return 7;
    });
  });
  assert.equal(value, 7);
  const row = modules[1].getDatabase().prepare("SELECT COUNT(*) AS count FROM audit_nest").get() as { count: number };
  assert.equal(row.count, 1);
});

test("requestClientAddress ignores unverified forwarding headers", () => {
  const spoofed = new Request("http://localhost", {
    headers: {
      "x-forwarded-for": "1.2.3.4, 10.0.0.1",
      "x-real-ip": "10.0.0.1",
    },
  });
  assert.equal(requestClientAddress(spoofed), "unknown");

  const lastHop = new Request("http://localhost", {
    headers: { "x-forwarded-for": "8.8.8.8, 10.1.1.1" },
  });
  assert.equal(requestClientAddress(lastHop), "unknown");
});

test("listChatsForUser reads chat_list instead of json_extract on chats.data", () => {
  const src = readFileSync(path.join(import.meta.dirname, "../lib/db-store.ts"), "utf8");
  const start = src.indexOf("export function listChatsForUser");
  const end = src.indexOf("export type ChatSearchResult");
  const fn = src.slice(start, end);
  assert.match(fn, /FROM chat_list/);
  assert.equal(/json_extract\(data/.test(fn), false);
  const { getDatabase } = modules[1];
  const plan = getDatabase()
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM chat_list
       WHERE owner_id = ? AND incognito = 0 AND (automation_run_id IS NULL OR automation_run_id = '') AND archived = 0`,
    )
    .all("owner-x") as Array<{ detail?: string }>;
  const details = plan.map((row) => row.detail || "").join("\n");
  assert.match(details, /chat_list/);
});

test("archived chats stay out of the default list", () => {
  const { createChat, listChatsForUser, updateChat } = modules[0];
  const open = createChat("Open");
  const archived = createChat("Archived");
  updateChat(archived.id, { archived: true });
  const listed = listChatsForUser();
  assert.equal(listed.some((chat) => chat.id === open.id), true);
  assert.equal(listed.some((chat) => chat.id === archived.id), false);
  assert.equal(
    listChatsForUser(undefined, { includeArchived: true }).some((chat) => chat.id === archived.id),
    true,
  );
});

test("upsertMessage patches one message without dropping list metadata", () => {
  const { appendMessage, createChat, getChat, listChatsForUser, upsertMessage } = modules[0];
  const chat = createChat("Checkpoint");
  appendMessage(chat.id, { role: "user", content: "hello" });
  const assistantId = randomUUID();
  upsertMessage(chat.id, { id: assistantId, role: "assistant", content: "one" });
  upsertMessage(chat.id, { id: assistantId, role: "assistant", content: "one two three" });
  const loaded = getChat(chat.id);
  assert.equal(loaded?.messages.at(-1)?.content, "one two three");
  assert.equal(loaded?.messages.filter((item) => item.id === assistantId).length, 1);
  assert.equal(listChatsForUser().find((item) => item.id === chat.id)?.title, "Checkpoint");
});

test("streaming message checkpoints preserve a project move made by another process", () => {
  const { appendMessage, createChat, getChat, updateChat, upsertMessage } = modules[0];
  const { getDatabase } = modules[1];
  const chat = createChat("Moving chat");
  appendMessage(chat.id, { role: "user", content: "keep working" });

  // Simulate the web process moving the chat while the worker still holds its
  // pre-run object in memory. Both JSON and the list projection are durable.
  getChat(chat.id);
  getDatabase().prepare(
    `UPDATE chats
     SET data = json_set(data, '$.projectId', ?), updated_at = ?
     WHERE id = ?`,
  ).run("project-during-run", new Date().toISOString(), chat.id);
  getDatabase().prepare("UPDATE chat_list SET project_id = ? WHERE id = ?")
    .run("project-during-run", chat.id);

  const assistantId = randomUUID();
  upsertMessage(chat.id, { id: assistantId, role: "assistant", content: "finished" });
  updateChat(chat.id, { runStatus: "completed" });

  assert.equal(getChat(chat.id)?.projectId, "project-during-run");
});

test("chat list poll is 30s idle and 10s while a run is active", () => {
  assert.equal(CHAT_LIST_POLL_IDLE_MS, 30_000);
  assert.equal(CHAT_LIST_POLL_ACTIVE_MS, 10_000);
  const src = readFileSync(path.join(import.meta.dirname, "../components/app-shell.tsx"), "utf8");
  assert.match(src, /CHAT_LIST_POLL_IDLE_MS/);
  assert.match(src, /document\.visibilityState === "hidden"/);
  assert.equal(/setInterval\(\(\) => void loadChats\(\), 10000\)/.test(src), false);
});

test("production mutating internal routes require the active run lease", async () => {
  const mutableEnv = process.env as unknown as Record<string, string | undefined>;
  const previousNodeEnv = mutableEnv.NODE_ENV;
  const previousToken = mutableEnv.MCP_BEARER_TOKEN;
  mutableEnv.NODE_ENV = "production";
  mutableEnv.MCP_BEARER_TOKEN = "production-audit-token";
  try {
    const { POST } = await import("../app/api/internal/mcp-file/route");
    const response = await POST(new Request("http://localhost/api/internal/mcp-file", {
      method: "POST",
      headers: {
        authorization: "Bearer production-audit-token",
        "x-ai-chat-id": "chat-id",
        "x-ai-chat-job-id": "job-id",
      },
      body: JSON.stringify({ path: "file.txt" }),
    }));
    assert.equal(response.status, 401);
  } finally {
    if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNodeEnv;
    if (previousToken === undefined) delete mutableEnv.MCP_BEARER_TOKEN;
    else mutableEnv.MCP_BEARER_TOKEN = previousToken;
  }
});

test("automation gateway forwards the active run lease", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../lib/mcp-core/gateway-core.mjs"), "utf8");
  const automationStart = source.indexOf('"create_automation", "list_automations"');
  const workspaceStart = source.indexOf('if (name === "list_workspaces"', automationStart);
  assert.notEqual(automationStart, -1);
  assert.notEqual(workspaceStart, -1);
  const automationGateway = source.slice(automationStart, workspaceStart);
  assert.match(automationGateway, /\.\.\.internalLeaseHeaders\(context\)/);
});

test("job-scoped internal gateway fetches forward the active run lease", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../lib/mcp-core/gateway-core.mjs"), "utf8");
  const missing: string[] = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const fetchAt = source.indexOf("await fetch(", searchFrom);
    if (fetchAt === -1) break;
    const headerStart = source.indexOf("headers:", fetchAt);
    const nextFetch = source.indexOf("await fetch(", fetchAt + 1);
    const headerEnd = headerStart === -1
      ? -1
      : source.indexOf("\n        });", headerStart);
    const chunkEnd = Math.min(
      fetchAt + 1_200,
      nextFetch === -1 ? source.length : nextFetch,
      headerEnd === -1 ? fetchAt + 1_200 : headerEnd + 20,
    );
    const chunk = source.slice(Math.max(0, fetchAt - 500), chunkEnd);
    searchFrom = fetchAt + 12;
    const urlLine = chunk.split("\n", 1)[0] || "";
    if (!/INTERNAL_[A-Z_]+|baseUrl/.test(urlLine) && !/INTERNAL_URL\.replace/.test(chunk.slice(0, 160))) continue;
    if (!/X-AI-Chat-Job-Id/.test(chunk)) continue;
    if (!/internalLeaseHeaders\(context\)/.test(chunk) && !/X-AI-Chat-Lease-Token/.test(chunk)) {
      missing.push(urlLine.replace(/\s+/g, " ").slice(0, 120));
    }
  }
  assert.deepEqual(missing, []);
});

test("mutating internal routes reject missing job IDs before processing the request", async () => {
  const previousToken = process.env.MCP_BEARER_TOKEN;
  process.env.MCP_BEARER_TOKEN = "lease-route-test-token";
  try {
    const routes = ["browser", "remote-client", "mcp-memory", "mcp-automation", "mcp-agent-state", "mcp-mode",
      "mcp-file", "mcp-chat", "mcp-workspace", "mcp-question", "mcp-notes", "mcp-wait", "mcp-subagent", "project-handoff", "mcp-approval"];
    for (const route of routes) {
      const { POST } = await import(`../app/api/internal/${route}/route`);
      for (const jobId of [undefined, "   "]) {
        const headers = new Headers({ authorization: "Bearer lease-route-test-token", "content-type": "application/json" });
        if (jobId !== undefined) headers.set("x-ai-chat-job-id", jobId);
        const response = await POST(new Request(`http://localhost/api/internal/${route}`, { method: "POST", headers, body: "{}" }));
        assert.equal(response.status, 401, `${route}, jobId=${JSON.stringify(jobId)}`);
      }
    }
  } finally {
    if (previousToken === undefined) delete process.env.MCP_BEARER_TOKEN;
    else process.env.MCP_BEARER_TOKEN = previousToken;
  }
});

test("lease enforcement is independent of NODE_ENV and permits a valid leased mutation", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = { NODE_ENV: env.NODE_ENV, MCP_BEARER_TOKEN: env.MCP_BEARER_TOKEN, AI_CHAT_TEST_BYPASS_LEASE: env.AI_CHAT_TEST_BYPASS_LEASE };
  const { internalRunLeaseAuthorized } = await import("../lib/internal-run-lease");
  const { POST } = await import("../app/api/internal/mcp-memory/route");
  const jobs = await import("../lib/db-jobs");
  const { createUser } = await import("../lib/auth");
  const owner = createUser("lease-audit-" + randomUUID(), "test-password");
  const chat = modules[0].createChat("Leased mutation", undefined, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "Test lease" });
  const lease = jobs.claimNextJob({ workerId: "audit-worker" })!;
  assert.equal(lease.id, job.id);
  const request = (extra: Record<string, string> = {}) => new Request("http://localhost/api/internal/mcp-memory", {
    method: "POST", headers: { authorization: "Bearer lease-audit-token", "content-type": "application/json",
      "x-ai-chat-id": chat.id, "x-ai-chat-user-id": owner.id, "x-ai-chat-job-id": job.id, ...extra },
    body: JSON.stringify({ action: "add", content: "synthetic leased memory" }),
  });
  const validHeaders = { "x-ai-chat-worker-id": lease.leaseOwner!, "x-ai-chat-lease-token": lease.leaseToken! };
  env.MCP_BEARER_TOKEN = "lease-audit-token";
  delete env.AI_CHAT_TEST_BYPASS_LEASE;
  try {
    for (const nodeEnv of ["development", "test", "production"]) {
      env.NODE_ENV = nodeEnv;
      assert.equal((await POST(request())).status, 401, nodeEnv);
      assert.equal((await POST(request({ "x-ai-chat-worker-id": lease.leaseOwner! }))).status, 401);
      assert.equal((await POST(request({ ...validHeaders, "x-ai-chat-lease-token": "wrong-token" }))).status, 401);
      assert.equal(internalRunLeaseAuthorized(request(validHeaders), "other-job"), false);
      const response = await POST(request(validHeaders));
      assert.equal(response.status, 200, nodeEnv);
      assert.equal((await response.json()).memory.content, "synthetic leased memory");
    }
    modules[1].getDatabase().prepare("UPDATE job_leases SET expires_at = ? WHERE job_id = ?")
      .run(new Date(Date.now() - 1_000).toISOString(), job.id);
    assert.equal((await POST(request(validHeaders))).status, 401);
    env.NODE_ENV = "test";
    env.AI_CHAT_TEST_BYPASS_LEASE = "true";
    assert.equal(internalRunLeaseAuthorized(request(), job.id), false);
    env.AI_CHAT_TEST_BYPASS_LEASE = "1";
    assert.equal(internalRunLeaseAuthorized(request(), job.id), true);
    assert.equal(internalRunLeaseAuthorized(request(), ""), false);
    const missingJob = request(); missingJob.headers.delete("x-ai-chat-job-id");
    assert.equal((await POST(missingJob)).status, 401);
    env.NODE_ENV = "production";
    assert.equal(internalRunLeaseAuthorized(request(), job.id), false, "test bypass must be dead in production");
  } finally {
    jobs.updateJob(job.id, { status: "cancelled" });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
  }
});

test("internal browser and engine reject the password-header fallback", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = { NODE_ENV: env.NODE_ENV, AI_CHAT_INTERNAL_TOKEN: env.AI_CHAT_INTERNAL_TOKEN, MCP_BEARER_TOKEN: env.MCP_BEARER_TOKEN };
  const { POST } = await import("../app/api/internal/browser/route");
  const { runInNewContext } = await import("node:vm");
  // Evaluate only the pure authorization function; importing server.mjs would start the server.
  const server = readFileSync(path.join(import.meta.dirname, "../server.mjs"), "utf8");
  const start = server.indexOf("function internalEngineAuthorized(request)");
  const end = server.indexOf("\nasync function readRequestJson", start);
  assert.ok(start >= 0 && end > start);
  const engineAuthorized = runInNewContext(`(${server.slice(start, end)})`, {
    process: { env }, passwordMatches: () => true,
  }) as (req: { headers: Record<string, string> }) => boolean;
  try {
    env.NODE_ENV = "production";
    delete env.AI_CHAT_INTERNAL_TOKEN; delete env.MCP_BEARER_TOKEN;
    const headers = { "x-ai-chat-internal": "1", "x-chat-password": "synthetic-password" };
    assert.equal(engineAuthorized({ headers }), false);
    assert.equal((await POST(new Request("http://localhost/api/internal/browser", { method: "POST", headers, body: "{}" }))).status, 401);
    env.MCP_BEARER_TOKEN = "synthetic-internal-token";
    assert.equal(engineAuthorized({ headers: { authorization: "Bearer synthetic-internal-token" } }), true);
    assert.equal(engineAuthorized({ headers: { authorization: "Bearer wrong-token" } }), false);
    env.AI_CHAT_INTERNAL_TOKEN = "synthetic-engine-token";
    assert.equal(engineAuthorized({ headers: { authorization: "Bearer synthetic-engine-token" } }), true);
    assert.equal(engineAuthorized({ headers: { authorization: "Bearer synthetic-internal-token" } }), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
  }
});
