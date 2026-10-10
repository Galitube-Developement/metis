import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = mkdtempSync(path.join(os.tmpdir(), "metis-agent-tools-"));
process.env.AI_CHAT_ROOT = directory;
process.env.AI_CHAT_MCP_STATE_DIR = path.join(directory, "state");
process.env.AI_CHAT_INTERNAL_ORIGIN = "http://127.0.0.1:1";
process.env.MCP_BEARER_TOKEN = "synthetic-runtime-test";
const { tools, dispatchGatewayTool, modeToolCategory } = await import("../lib/mcp-core/gateway-core.mjs");

test("canonical agent tools advertise and route the shared custom / unlimited runtime contract", async () => {
 const original = globalThis.fetch;
 const requests = [];
 globalThis.fetch = async (url, options) => {
  requests.push({ url: String(url), body: JSON.parse(options.body), headers: options.headers, signal: options.signal, dispatcher: options.dispatcher });
  return Response.json({ status: "cancelled", agentId: "child", delegated: true });
 };
 const context = { chatId: "parent-chat", jobId: "parent-job", userId: "synthetic",
  isHostAdmin: true, allowRoot: true, uid: process.getuid?.(), gid: process.getgid?.(),
  runtimeMode: "full-access", modePolicy: JSON.stringify({ allowedCategories: ["subagent", "read"], toolOverrides: {} }) };
 try {
  for (const name of ["delegate_subagent", "project_handoff"]) {
   const schema = tools.find(tool => tool.name === name).inputSchema.properties.timeoutMs;
   assert.equal(schema.default, undefined); assert.equal(schema.maximum, undefined);
   assert.deepEqual(schema.anyOf, [{ const: 0 }, { minimum: 900_000 }]);
  }
  assert.equal(modeToolCategory("subagent_cancel"), "subagent");
  assert.ok(tools.find(tool => tool.name === "project_handoff").inputSchema.properties.action.enum.includes("stop"));
  for (const [timeoutMs, expected] of [[undefined, undefined], [43_200_000, 43_200_000], [0, 0]]) {
   const result = await dispatchGatewayTool("delegate_subagent", { prompt: "Read scope", wait: false, timeoutMs }, { context, auditCall: false });
   assert.ok(!result.isError, JSON.stringify(result));
   assert.equal(requests.at(-1).body.timeoutMs, expected);
  }
  const controller = new AbortController();
   for (const name of ["delegate_subagent", "project_handoff"]) {
    for (const timeoutMs of [undefined, 0, 30 * 24 * 60 * 60_000]) {
     const result = await dispatchGatewayTool(name, { prompt: "Read scope", recipientAgentId: "peer", task: "Read scope", timeoutMs }, { context: { ...context, signal: controller.signal }, auditCall: false });
     assert.ok(!result.isError, JSON.stringify(result));
     assert.equal(requests.at(-1).body.timeoutMs, timeoutMs);
     assert.equal(requests.at(-1).signal, controller.signal, "waiting uses cancellation, not a hidden transport deadline");
     assert.ok(requests.at(-1).dispatcher, "long waits also override fetch's default HTTP header timeout");
    }
   }
   const cancelled = await dispatchGatewayTool("subagent_cancel", { agentId: "child" }, { context, auditCall: false });
  assert.ok(!cancelled.isError, JSON.stringify(cancelled));
  assert.match(requests.at(-1).url, /mcp-agent-state$/);
  assert.equal(requests.at(-1).body.action, "cancel");
  assert.equal(requests.at(-1).body.agentId, "child");
  const before = requests.length;
  const denied = await dispatchGatewayTool("subagent_cancel", { agentId: "child" }, { context: { ...context, modePolicy: JSON.stringify({ allowedCategories: ["read"], toolOverrides: {} }) }, auditCall: false });
  assert.equal(denied.isError, true); assert.equal(requests.length, before);
  const stopped = await dispatchGatewayTool("project_handoff", { action: "stop", agentId: "peer" }, { context, auditCall: false });
  assert.ok(!stopped.isError, JSON.stringify(stopped));
  assert.equal(requests.at(-1).body.agentId, "peer");
  assert.equal(requests.at(-1).body.action, "stop");
 } finally { globalThis.fetch = original; rmSync(directory, { recursive: true, force: true }); }
});
