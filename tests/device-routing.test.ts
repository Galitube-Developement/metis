import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEVICE_ROUTING_PROMPT, DEVICE_TOOL_DESCRIPTIONS } from "../lib/mcp-core/device-routing.mjs";
import { METIS_SHARED_AGENT_CONTROL } from "../lib/agent-control";
import { selectBridgeTools } from "../lib/mcp-bridge";

const temp = mkdtempSync(path.join(os.tmpdir(), "metis-device-routing-"));
process.env.AI_CHAT_ROOT = temp;
process.env.AI_CHAT_MCP_STATE_DIR = temp;
process.env.AI_CHAT_INTERNAL_ORIGIN = "http://127.0.0.1:1";
process.env.MCP_BEARER_TOKEN = "fixture-token";
delete process.env.MCP_PC_HOST;
delete process.env.MCP_LAPTOP_HOST;
let gateway: typeof import("../lib/mcp-core/gateway-core.mjs");
before(async () => { gateway = await import("../lib/mcp-core/gateway-core.mjs"); });
after(() => rmSync(temp, { recursive: true, force: true }));

const context = { userId: "owner-a", runtimeMode: "full-access", source: "agent" };
const call = (name: string, args: Record<string, unknown> = {}) =>
  gateway.dispatchGatewayTool(name, args, { context, auditCall: false });
const parsed = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text);
const clients = [
  { id: "client-gaming", name: "GamingPC", hostname: "DESKTOP-FVKEVP2", os: "Windows 11", status: "online" },
  { id: "client-home", name: "Home PC", hostname: "HOME-DESKTOP", os: "Windows 11", status: "offline" },
  { id: "client-laptop", name: "Laptop", hostname: "laptop", os: "Linux", status: "online" },
];

test("device rules reach the shared provider prompt and MCP handshake", () => {
  assert.ok(METIS_SHARED_AGENT_CONTROL.includes(DEVICE_ROUTING_PROMPT));
  const source = readFileSync(new URL("../lib/mcp-core/gateway-core.mjs", import.meta.url), "utf8");
  assert.match(source, /instructions:.*\$\{DEVICE_ROUTING_PROMPT\}/);
  assert.match(DEVICE_ROUTING_PROMPT, /list_remote_clients\(\{\}\) FIRST/);
  assert.match(DEVICE_ROUTING_PROMPT, /hostname or id/);
  assert.match(DEVICE_ROUTING_PROMPT, /device availability is UNKNOWN/);
});

test("device tool help stays complete within the provider's 500-character limit", () => {
  for (const [name, description] of Object.entries(DEVICE_TOOL_DESCRIPTIONS)) {
    assert.ok(description.length <= 500, name + " gets truncated");
    assert.equal(gateway.tools.find((tool) => tool.name === name)?.description, description);
  }
  for (const name of ["assistant_status", "gateway_status"]) {
    assert.match(DEVICE_TOOL_DESCRIPTIONS[name], /NOT/);
    assert.match(DEVICE_TOOL_DESCRIPTIONS[name], /list_remote_clients/);
  }
});

test("provider bridge exposes discovery, shell and visible desktop actions without health preflights", () => {
  const required = ["list_remote_clients", "system_info", "execute_command", "remote_client_terminal",
    "windows_desktop_job", "windows_ui", "windows_screenshot", "computer_use", "electron_test"];
  assert.deepEqual(selectBridgeTools([...required, "assistant_status", "gateway_status"]), required);
});

test("Remote Devices discovery preserves names, hostnames and offline entries for the authenticated owner", async (t) => {
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    return Response.json({ clients });
  });
  assert.deepEqual(parsed(await call("list_remote_clients")), clients);
  assert.equal((requests[0].headers as Record<string, string>)["X-AI-Chat-User-Id"], "owner-a");
});

test("failed or malformed discovery stays unknown instead of becoming an empty device list", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));
  let result = await call("list_remote_clients");
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.match(result.content[0].text, /device availability is unknown/);
  fetchMock.mock.mockImplementation(async () => Response.json({ error: "discovery unavailable" }, { status: 503 }));
  result = await call("list_remote_clients");
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.match(result.content[0].text, /discovery unavailable/);
  fetchMock.mock.mockImplementation(async () => Response.json({ clients: [] }));
  assert.deepEqual(parsed(await call("list_remote_clients")), []);
});

test("device discovery without an authenticated account fails before making a request", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ clients }));
  const result = await gateway.dispatchGatewayTool("list_remote_clients", {}, { auditCall: false });
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.match(result.content[0].text, /authenticated account/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("GamingPC and its hostname resolve to the same returned id for remote shell and desktop launch", async (t) => {
  const posts: Array<{ clientId: string; action: string; params: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ result: { stdout: "1234", stderr: "", exitCode: 0 } });
    }
    return Response.json({ clients });
  });
  const inventory = parsed(await call("list_remote_clients")) as typeof clients;
  for (const name of ["GamingPC", "DESKTOP-FVKEVP2"]) {
    const device = inventory.find((client) => client.name === name || client.hostname === name)!;
    await call("execute_command", { target: "client:" + device.id, command: "hostname" });
    const launched = parsed(await call("windows_desktop_job", {
      client_id: device.id, action: "spawn", command: ["C:\\Games\\Launcher.exe"],
    }));
    assert.equal(launched.pid, 1234);
  }
  assert.equal(posts.length, 4);
  assert.ok(posts.every((post) => post.clientId === "client-gaming"));
  assert.ok(posts.every((post) => post.action === "execute_command"));
});

test("offline Windows device cannot trigger a desktop command on another host", async (t) => {
  const posts: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    if (init?.method === "POST") posts.push(init.body);
    return Response.json({ clients });
  });
  const result = await call("windows_desktop_job", {
    client_id: "client-home", action: "spawn", command: ["C:\\Games\\Launcher.exe"],
  });
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.match(result.content[0].text, /not online for this account/);
  assert.equal(posts.length, 0);
});

test("assistant status marks infrastructure scope and never invents a remote-client service", async () => {
  const result = parsed(await gateway.dispatchGatewayTool("assistant_status", {}, {
    auditCall: false,
    context: { uid: process.getuid?.(), gid: process.getgid?.(), allowRoot: true, workspaceRoot: os.homedir(), home: os.homedir() },
  }));
  assert.equal(result.scope, "metis_infrastructure_only");
  assert.equal(result.remote_devices.status, "not_queried");
  assert.equal(result.remote_devices.discovery_tool, "list_remote_clients");
  assert.equal("devices" in result, false);
  assert.equal("metis-ai-remote-client" in result.services, false);
});
