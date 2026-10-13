import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";

test("question and reconnect gate wait beyond the normal HTTP header limit and still cancel", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "metis-question-transport-"));
  const calls = [];
  const server = createServer((req, res) => {
    req.resume();
    calls.push({ path: req.url, method: req.method, headers: req.headers });
    const timer = setTimeout(() => {
      if (res.destroyed) return;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.method === "GET" ? { waitingForUser: false }
        : req.url === "/api/internal/mcp-question" ? { questionId: "synthetic", values: { value: "submitted" }, answers: ["submitted"] }
          : { snapshot: "continued" }));
    }, req.url === "/api/internal/browser" ? 0 : 1800);
    res.once("close", () => clearTimeout(timer));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = "http://127.0.0.1:" + address.port;
  Object.assign(process.env, { AI_CHAT_ROOT: directory, AI_CHAT_MCP_STATE_DIR: path.join(directory, "mcp"),
    AI_CHAT_INTERNAL_ORIGIN: base, MCP_BEARER_TOKEN: "synthetic-question-token" });
  for (const name of ["AI_CHAT_INTERNAL_URL", "AI_CHAT_BROWSER_URL"]) delete process.env[name];
  const previous = getGlobalDispatcher();
  const short = new Agent({ headersTimeout: 50, bodyTimeout: 50 });
  setGlobalDispatcher(short);
  try {
    const { dispatchGatewayTool } = await import("../lib/mcp-core/gateway-core.mjs");
    const context = { chatId: "chat", userId: "owner", jobId: "job",
      workerId: "worker", leaseToken: "synthetic-lease", runtimeMode: "full-access", isHostAdmin: true };
    const call = (name, args = {}, signal) => dispatchGatewayTool(name, args, { context, auditCall: false, signal });
    const answer = await call("ask_user", { questions: [{ question: "Value", key: "value" }] });
    assert.notEqual(answer.isError, true, JSON.stringify(answer));
    assert.equal(JSON.parse(answer.content[0].text).values.value, "submitted");
    const continued = await call("browser_snapshot");
    assert.notEqual(continued.isError, true, JSON.stringify(continued));
    assert.ok(calls.some(call => call.method === "GET" && call.path === "/api/internal/mcp-question"));
    for (const request of calls) {
      assert.equal(request.headers["x-ai-chat-job-id"], "job");
      assert.equal(request.headers["x-ai-chat-worker-id"], "worker");
      assert.equal(request.headers["x-ai-chat-lease-token"], "synthetic-lease");
    }
    const controller = new AbortController();
    const waiting = call("ask_user", { questions: [{ question: "Cancel fixture" }] }, controller.signal);
    setTimeout(() => controller.abort(), 50);
    assert.equal((await waiting).isError, true);
  } finally {
    setGlobalDispatcher(previous);
    await short.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
