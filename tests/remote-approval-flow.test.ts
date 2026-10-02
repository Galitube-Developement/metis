import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-approval-flow-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
process.env.MCP_BEARER_TOKEN = "approval-flow-test-only";
delete process.env.AI_CHAT_JOB_ID;
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;

const loaded = Promise.all([
  import("../lib/auth"), import("../lib/remote-clients"), import("../lib/remote-client-gateway"),
  import("../lib/db-store"), import("../lib/db-jobs"), import("../lib/db-approvals"),
  import("../app/api/internal/remote-client/route"), import("../app/api/chat/approval/route"),
  import("../app/api/chats/[id]/route"), import("../lib/remote-approval-flow"),
  import("../lib/sqlite"),
]);
let modules!: Awaited<typeof loaded>;
before(async () => { modules = await loaded; });
after(() => { rmSync(dataDir, { recursive: true, force: true }); });

function fixture(fullAccess = false, automation = false) {
  const [auth, clients, gateway, store, jobs] = modules;
  const name = "approval-" + randomUUID();
  const owner = auth.createUser(name, "test-password");
  const session = auth.authenticateUser(name, "test-password")!;
  const client = clients.registerRemoteClient(
    clients.createEnrollmentToken(owner.id, undefined, "admin").token,
    { name: "Fixture PC", permissionMode: "admin" },
  )!.client!;
  clients.updateRemoteClient(client.id, owner.id, { policy: {
    mode: fullAccess ? "full_access" : "approval_required",
    allowlist: ["whoami", "echo second"],
  } });
  const chat = store.createChat("Approval test", undefined, owner.id);
  store.updateChat(chat.id, { runtimeMode: "full-access", runStatus: "running" }, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "Test",
    ...(automation ? { automationId: "fixture-automation" } : {}),
  });
  jobs.updateJob(job.id, { status: "running" });
  const sent: Array<Record<string, unknown>> = [];
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number; send: (data: string) => void; close: () => void;
  };
  socket.readyState = 1;
  socket.send = (data) => {
    const request = JSON.parse(data);
    if (request.type !== "request") return;
    sent.push(request);
    queueMicrotask(() => socket.emit("message", JSON.stringify({
      type: "response", requestId: request.requestId, ok: true, result: { stdout: "fixture-result" },
    })));
  };
  socket.close = () => { socket.readyState = 3; socket.emit("close"); };
  gateway.attachRemoteClient(socket, client.id, owner.id);
  const input = {
    ownerId: owner.id, clientId: client.id, action: "execute_command" as const,
    params: { command: "whoami" }, runId: job.id, source: "agent" as const,
  };
  const controller = new AbortController();
  const request = () => new Request("http://localhost/api/internal/remote-client", {
    method: "POST", signal: controller.signal,
    headers: { authorization: "Bearer approval-flow-test-only", "x-ai-chat-user-id": owner.id, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const decide = (id: string, decision = "allow", token = session.token) =>
    modules[7].POST(new Request("http://localhost/api/chat/approval", {
      method: "POST", headers: { cookie: "ai_chat_auth=" + token, "content-type": "application/json" },
      body: JSON.stringify({ approvalId: id, decision }),
    }));
  return { owner, client, chat, job, session, sent, socket, input, controller, request, decide };
}

async function pendingId(f: ReturnType<typeof fixture>) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = modules[3].getChat(f.chat.id, f.owner.id)?.pendingApproval?.id;
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Approval card was not published.");
}

test("Full Access sends an admin action directly without creating any approval", async () => {
  const f = fixture(true);
  try {
    const response = await modules[6].POST(f.request());
    assert.equal(response.status, 200);
    assert.equal(f.sent.length, 1);
    assert.equal(modules[3].getChat(f.chat.id, f.owner.id)?.pendingApproval, undefined);
    assert.equal(modules[5].getPendingApprovalForChat(f.chat.id, f.owner.id), null);
  } finally { f.controller.abort(); f.socket.close(); }
});

test("remote approval appears in the actual chat API and Allow executes the waiting call exactly once", async () => {
  const f = fixture();
  const waiting = modules[6].POST(f.request());
  try {
    const id = await pendingId(f);
    assert.equal(f.sent.length, 0);
    assert.equal(modules[5].getApproval(id, f.owner.id)?.approvalId, id);
    assert.equal(modules[1].getRemoteApproval(id, f.owner.id)?.id, id);
    const page = await modules[8].GET(new Request("http://localhost/api/chats/" + f.chat.id, {
      headers: { cookie: "ai_chat_auth=" + f.session.token },
    }), { params: Promise.resolve({ id: f.chat.id }) });
    assert.equal((await page.json()).chat.pendingApproval.id, id);
    assert.equal((await f.decide(id)).status, 200);
    assert.equal((await waiting).status, 200);
    assert.equal(f.sent.length, 1);
    assert.ok(modules[1].getRemoteApproval(id, f.owner.id)?.consumedAt);
    assert.equal(modules[3].getChat(f.chat.id, f.owner.id)?.pendingApproval ?? null, null);
    assert.equal(modules[4].getJob(f.job.id)?.status, "running");
    assert.equal((await f.decide(id)).status, 404);
  } finally { f.controller.abort(); await waiting; f.socket.close(); }
});

test("Deny releases the card and executes no remote action", async () => {
  const f = fixture();
  const waiting = modules[6].POST(f.request());
  try {
    const id = await pendingId(f);
    assert.equal((await f.decide(id, "deny")).status, 200);
    const result = await waiting;
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, /denied/i);
    assert.equal(f.sent.length, 0);
    assert.equal(modules[1].consumeRemoteApproval({ ...f.input, id }), false);
  } finally { f.controller.abort(); await waiting; f.socket.close(); }
});

test("foreign accounts cannot approve the card; changing arguments or reusing an ID cannot execute", async () => {
  const f = fixture();
  const waiting = modules[6].POST(f.request());
  try {
    const id = await pendingId(f);
    const name = "other-" + randomUUID();
    modules[0].createUser(name, "password");
    const other = modules[0].authenticateUser(name, "password")!;
    assert.equal((await f.decide(id, "allow", other.token)).status, 404);
    assert.equal(f.sent.length, 0);
    assert.equal((await f.decide(id)).status, 200);
    assert.equal(modules[1].consumeRemoteApproval({ ...f.input, id, params: { command: "echo second" } }), false);
    assert.equal((await waiting).status, 200);
    assert.throws(() => modules[2].requestRemoteClient({ ...f.input, approvalId: id }), /already used/);
    assert.equal(f.sent.length, 1);
  } finally { f.controller.abort(); await waiting; f.socket.close(); }
});

test("Allow session applies only to the approved device and exact action arguments", async () => {
  const f = fixture();
  const waiting = modules[6].POST(f.request());
  try {
    const id = await pendingId(f);
    assert.equal((await f.decide(id, "allow-session")).status, 200);
    assert.equal((await waiting).status, 200);
    await modules[2].requestRemoteClient(f.input);
    assert.equal(f.sent.length, 2);
    assert.throws(() => modules[2].requestRemoteClient({ ...f.input, params: { command: "echo second" } }), /approval/i);
    assert.equal(f.sent.length, 2);
    const secondId = await pendingId(f);
    await f.decide(secondId, "deny");
  } finally { f.controller.abort(); await waiting; f.socket.close(); }
});

test("an approved ID survives a disconnected waiter and is consumed by the exact owning run retry", async () => {
  const f = fixture();
  const waiting = modules[6].POST(f.request());
  try {
    const id = await pendingId(f);
    f.controller.abort();
    await waiting;
    // A stale heartbeat means the worker no longer waits; accepting queues a resume.
    modules[10].getDatabase().prepare("UPDATE pending_approvals SET heartbeat_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 10_000).toISOString(), id);
    assert.equal((await f.decide(id)).status, 200);
    assert.equal(modules[4].getJob(f.job.id)?.status, "queued");
    modules[4].updateJob(f.job.id, { status: "running" });
    await modules[2].requestRemoteClient(f.input);
    assert.equal(f.sent.length, 1);
    assert.ok(modules[1].getRemoteApproval(id, f.owner.id)?.consumedAt);
  } finally { f.controller.abort(); await waiting; f.socket.close(); }
});

test("expired approvals cannot silently execute", async () => {
  const f = fixture();
  const waiting = modules[6].POST(f.request());
  try {
    const id = await pendingId(f);
    modules[1].denyRemoteApproval(id, f.owner.id);
    assert.equal((await f.decide(id)).status, 404);
    assert.equal((await waiting).status, 400);
    assert.equal(f.sent.length, 0);
    assert.equal(modules[5].getPendingApprovalForChat(f.chat.id, f.owner.id), null);
  } finally { f.controller.abort(); await waiting; f.socket.close(); }
});

test("automation runs fail clearly when the device requires interactive approval", async () => {
  const f = fixture(false, true);
  try {
    const response = await modules[6].POST(f.request());
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /automation/);
    assert.equal(f.sent.length, 0);
    assert.equal(modules[5].getPendingApprovalForChat(f.chat.id, f.owner.id), null);
  } finally { f.controller.abort(); f.socket.close(); }
});

test("parallel approval requests remain visible one after another", async () => {
  const f = fixture();
  const first = modules[6].POST(f.request());
  let second: Promise<Response> | undefined;
  try {
    const firstId = await pendingId(f);
    second = modules[6].POST(new Request("http://localhost/api/internal/remote-client", {
      method: "POST", signal: f.controller.signal,
      headers: { authorization: "Bearer approval-flow-test-only", "x-ai-chat-user-id": f.owner.id, "content-type": "application/json" },
      body: JSON.stringify({ ...f.input, params: { command: "echo second" } }),
    }));
    let secondId = firstId;
    for (let attempt = 0; attempt < 50 && secondId === firstId; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      secondId = await pendingId(f);
    }
    assert.notEqual(secondId, firstId);
    assert.equal((await f.decide(secondId)).status, 200);
    assert.equal((await second).status, 200);
    assert.equal(await pendingId(f), firstId);
    assert.equal((await f.decide(firstId)).status, 200);
    assert.equal((await first).status, 200);
    assert.equal(f.sent.length, 2);
    assert.equal(modules[5].getPendingApprovalForChat(f.chat.id, f.owner.id), null);
  } finally { f.controller.abort(); await first; if (second) await second; f.socket.close(); }
});
