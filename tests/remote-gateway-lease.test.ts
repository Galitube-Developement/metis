import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(path.join(os.tmpdir(), "metis-remote-gateway-lease-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  CHAT_DATA_DIR: directory,
  CHAT_DB_PATH: path.join(directory, "chat.sqlite"),
  AGENT_CWD: directory,
  AI_CHAT_ROOT: directory,
  AI_CHAT_MCP_STATE_DIR: path.join(directory, "mcp-state"),
  AI_CHAT_INTERNAL_ORIGIN: "http://127.0.0.1:1",
  MCP_BEARER_TOKEN: "synthetic-remote-gateway-token",
});
for (const key of ["AI_CHAT_TEST_BYPASS_LEASE", "AI_CHAT_JOB_ID",
  "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[key];

const loaded = Promise.all([
  import("../lib/auth"),
  import("../lib/remote-clients"),
  import("../lib/remote-client-gateway"),
  import("../lib/db-store"),
  import("../lib/db-jobs"),
  import("../app/api/internal/remote-client/route"),
  import("../lib/mcp-core/gateway-core.mjs"),
]);
after(() => rmSync(directory, { recursive: true, force: true }));

test("remote gateway authenticates with the real job lease and rejects invalid context", async (t) => {
  const [auth, clients, remote, store, jobs, route, gateway] = await loaded;
  const owner = auth.createUser("remote-lease-owner", "synthetic-test-password");
  const other = auth.createUser("remote-lease-other", "synthetic-test-password");
  const client = clients.registerRemoteClient(
    clients.createEnrollmentToken(owner.id, undefined, "admin").token,
    { name: "Synthetic PC", permissionMode: "admin" },
  )!.client!;
  clients.updateRemoteClient(client.id, owner.id, { policy: { mode: "full_access", allowlist: [] } });
  const chat = store.createChat("Remote lease test", undefined, owner.id);
  store.updateChat(chat.id, { runtimeMode: "full-access", runStatus: "running" }, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "Synthetic test" });
  const claimed = jobs.claimNextJob({ workerId: "synthetic-remote-worker" })!;
  assert.equal(claimed.id, job.id);
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
      type: "response", requestId: request.requestId, ok: true,
      result: { stdout: "REMOTE_LEASE_OK", exit_code: 0 },
    })));
  };
  socket.close = () => { socket.readyState = 3; socket.emit("close"); };
  remote.attachRemoteClient(socket, client.id, owner.id);

  const requests: Array<{ status: number; headers: Headers }> = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    const request = new Request(url, options);
    if (new URL(request.url).pathname === "/api/internal/remote-client") {
      const response = request.method === "GET" ? await route.GET(request) : await route.POST(request);
      requests.push({ status: response.status, headers: request.headers });
      return response;
    }
    // Question/approval coordination stays synthetic; the remote API and lease
    // checks above run against a real isolated DB and the fixture socket.
    return Response.json({ waitingForUser: false });
  });
  const context = {
    userId: owner.id, chatId: chat.id, jobId: job.id, source: "agent",
    workerId: claimed.leaseOwner!, leaseToken: claimed.leaseToken!,
    runtimeMode: "full-access",
  };
  const resultText = (result: { content?: Array<{ type: string; text?: string }> }) =>
    result.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") || "";
  const isError = (result: object) => "isError" in result && result.isError === true;
  const call = (name: string, args: Record<string, unknown>, overrides = {}) =>
    gateway.dispatchGatewayTool(name, args, { auditCall: false, context: { ...context, ...overrides } });

  try {
    for (const [name, args] of [
      ["read_file", { target: "client:" + client.id, path: "C:\\synthetic\\test.txt" }],
      ["list_directory", { target: "client:" + client.id, path: "C:\\synthetic" }],
      ["execute_command", { target: "client:" + client.id, command: "whoami", timeout: 5 }],
    ] as const) {
      await t.test(name + " reaches the fixture device with a valid lease", async () => {
        const count = sent.length;
        const result = await call(name, args);
        assert.ok(!isError(result), resultText(result));
        assert.match(resultText(result), /REMOTE_LEASE_OK/);
        assert.equal(sent.length, count + 1);
        const request = requests.at(-1)!;
        assert.equal(request.status, 200);
        assert.equal(request.headers.get("x-ai-chat-job-id"), job.id);
        assert.equal(request.headers.get("x-ai-chat-worker-id"), claimed.leaseOwner);
        assert.equal(request.headers.get("x-ai-chat-lease-token"), claimed.leaseToken);
        assert.equal(request.headers.get("x-chat-password"), null);
      });
    }

    for (const [label, overrides] of [
      ["missing job", { jobId: "" }],
      ["missing worker", { workerId: "" }],
      ["missing lease", { leaseToken: "" }],
      ["incorrect lease", { leaseToken: "synthetic-invalid-lease" }],
    ]) {
      await t.test(label + " returns Unauthorized without sending to the device", async () => {
        const count = sent.length;
        const result = await call("read_file", { target: "client:" + client.id, path: "C:\\synthetic\\test.txt" }, overrides);
        assert.equal(isError(result), true);
        assert.match(resultText(result), /Unauthorized/);
        assert.equal(requests.at(-1)!.status, 401);
        assert.equal(sent.length, count);
      });
    }

    await t.test("another account cannot use the owner's device", async () => {
      const count = sent.length;
      const result = await call("read_file", { target: "client:" + client.id, path: "C:\\synthetic\\test.txt" }, { userId: other.id });
      assert.equal(isError(result), true);
      assert.equal(sent.length, count);
    });

    await t.test("completed job lease is rejected", async () => {
      jobs.updateJob(job.id, { status: "completed" });
      const count = sent.length;
      const result = await call("read_file", { target: "client:" + client.id, path: "C:\\synthetic\\test.txt" });
      assert.equal(isError(result), true);
      assert.match(resultText(result), /Unauthorized/);
      assert.equal(sent.length, count);
    });
  } finally { socket.close(); }
});
