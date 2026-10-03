     1	import assert from "node:assert/strict";
     2	import test, { before, after } from "node:test";
     3	import { mkdtempSync, rmSync, readFileSync } from "node:fs";
     4	import os from "node:os";
     5	import path from "node:path";
     6	import { DEVICE_ROUTING_PROMPT, DEVICE_TOOL_DESCRIPTIONS } from "../lib/mcp-core/device-routing.mjs";
     7	import { METIS_SHARED_AGENT_CONTROL } from "../lib/agent-control";
     8	import { selectBridgeTools } from "../lib/mcp-bridge";
     9	
    10	const temp = mkdtempSync(path.join(os.tmpdir(), "metis-device-routing-"));
    11	process.env.AI_CHAT_ROOT = temp;
    12	process.env.AI_CHAT_MCP_STATE_DIR = temp;
    13	process.env.AI_CHAT_INTERNAL_ORIGIN = "http://127.0.0.1:1";
    14	process.env.MCP_BEARER_TOKEN = "fixture-token";
    15	delete process.env.MCP_PC_HOST;
    16	delete process.env.MCP_LAPTOP_HOST;
    17	let gateway: typeof import("../lib/mcp-core/gateway-core.mjs");
    18	before(async () => { gateway = await import("../lib/mcp-core/gateway-core.mjs"); });
    19	after(() => rmSync(temp, { recursive: true, force: true }));
    20	
    21	const context = { userId: "owner-a", runtimeMode: "full-access", source: "agent" };
    22	const call = (name: string, args: Record<string, unknown> = {}) =>
    23	  gateway.dispatchGatewayTool(name, args, { context, auditCall: false });
    24	const parsed = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text);
    25	const clients = [
    26	  { id: "client-gaming", name: "GamingPC", hostname: "DESKTOP-FVKEVP2", os: "Windows 11", status: "online" },
    27	  { id: "client-home", name: "Home PC", hostname: "HOME-DESKTOP", os: "Windows 11", status: "offline" },
    28	  { id: "client-laptop", name: "Laptop", hostname: "laptop", os: "Linux", status: "online" },
    29	];
    30	
    31	test("device rules reach the shared provider prompt and MCP handshake", () => {
    32	  assert.ok(METIS_SHARED_AGENT_CONTROL.includes(DEVICE_ROUTING_PROMPT));
    33	  const source = readFileSync(new URL("../lib/mcp-core/gateway-core.mjs", import.meta.url), "utf8");
    34	  assert.match(source, /instructions:.*\$\{DEVICE_ROUTING_PROMPT\}/);
    35	  assert.match(DEVICE_ROUTING_PROMPT, /list_remote_clients\(\{\}\) FIRST/);
    36	  assert.match(DEVICE_ROUTING_PROMPT, /hostname or id/);
    37	  assert.match(DEVICE_ROUTING_PROMPT, /device availability is UNKNOWN/);
    38	});
    39	
    40	test("device tool help stays complete within the provider's 500-character limit", () => {
    41	  for (const [name, description] of Object.entries(DEVICE_TOOL_DESCRIPTIONS)) {
    42	    assert.ok(description.length <= 500, name + " gets truncated");
    43	    assert.equal(gateway.tools.find((tool) => tool.name === name)?.description, description);
    44	  }
    45	  for (const name of ["assistant_status", "gateway_status"]) {
    46	    assert.match(DEVICE_TOOL_DESCRIPTIONS[name], /NOT/);
    47	    assert.match(DEVICE_TOOL_DESCRIPTIONS[name], /list_remote_clients/);
    48	  }
    49	});
    50	
    51	test("provider bridge exposes discovery, shell and visible desktop actions without health preflights", () => {
    52	  const required = ["list_remote_clients", "system_info", "execute_command", "remote_client_terminal",
    53	    "windows_desktop_job", "windows_ui", "windows_screenshot", "computer_use", "electron_test"];
    54	  assert.deepEqual(selectBridgeTools([...required, "assistant_status", "gateway_status"]), required);
    55	});
    56	
    57	test("Remote Devices discovery preserves names, hostnames and offline entries for the authenticated owner", async (t) => {
    58	  const requests: RequestInit[] = [];
    59	  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    60	    requests.push(init);
    61	    return Response.json({ clients });
    62	  });
    63	  assert.deepEqual(parsed(await call("list_remote_clients")), clients);
    64	  assert.equal((requests[0].headers as Record<string, string>)["X-AI-Chat-User-Id"], "owner-a");
    65	});
    66	
    67	test("failed or malformed discovery stays unknown instead of becoming an empty device list", async (t) => {
    68	  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));
    69	  let result = await call("list_remote_clients");
    70	  assert.equal((result as { isError?: boolean }).isError, true);
    71	  assert.match(result.content[0].text, /device availability is unknown/);
    72	  fetchMock.mock.mockImplementation(async () => Response.json({ error: "discovery unavailable" }, { status: 503 }));
    73	  result = await call("list_remote_clients");
    74	  assert.equal((result as { isError?: boolean }).isError, true);
    75	  assert.match(result.content[0].text, /discovery unavailable/);
    76	  fetchMock.mock.mockImplementation(async () => Response.json({ clients: [] }));
    77	  assert.deepEqual(parsed(await call("list_remote_clients")), []);
    78	});
    79	
    80	test("device discovery without an authenticated account fails before making a request", async (t) => {
    81	  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ clients }));
    82	  const result = await gateway.dispatchGatewayTool("list_remote_clients", {}, { auditCall: false });
    83	  assert.equal((result as { isError?: boolean }).isError, true);
    84	  assert.match(result.content[0].text, /authenticated account/);
    85	  assert.equal(fetchMock.mock.callCount(), 0);
    86	});
    87	
    88	test("GamingPC and its hostname resolve to the same returned id for remote shell and desktop launch", async (t) => {
    89	  const posts: Array<{ clientId: string; action: string; params: Record<string, unknown> }> = [];
    90	  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    91	    if (init?.method === "POST") {
    92	      posts.push(JSON.parse(String(init.body)));
    93	      return Response.json({ result: { stdout: "1234", stderr: "", exitCode: 0 } });
    94	    }
    95	    return Response.json({ clients });
    96	  });
    97	  const inventory = parsed(await call("list_remote_clients")) as typeof clients;
    98	  for (const name of ["GamingPC", "DESKTOP-FVKEVP2"]) {
    99	    const device = inventory.find((client) => client.name === name || client.hostname === name)!;
   100	    await call("execute_command", { target: "client:" + device.id, command: "hostname" });
   101	    const launched = parsed(await call("windows_desktop_job", {
   102	      client_id: device.id, action: "spawn", command: ["C:\\Games\\Launcher.exe"],
   103	    }));
   104	    assert.equal(launched.pid, 1234);
   105	  }
   106	  assert.equal(posts.length, 4);
   107	  assert.ok(posts.every((post) => post.clientId === "client-gaming"));
   108	  assert.ok(posts.every((post) => post.action === "execute_command"));
   109	});
   110	
   111	test("offline Windows device cannot trigger a desktop command on another host", async (t) => {
   112	  const posts: unknown[] = [];
   113	  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
   114	    if (init?.method === "POST") posts.push(init.body);
   115	    return Response.json({ clients });
   116	  });
   117	  const result = await call("windows_desktop_job", {
   118	    client_id: "client-home", action: "spawn", command: ["C:\\Games\\Launcher.exe"],
   119	  });
   120	  assert.equal((result as { isError?: boolean }).isError, true);
   121	  assert.match(result.content[0].text, /not online for this account/);
   122	  assert.equal(posts.length, 0);
   123	});
   124	
   125	test("assistant status marks infrastructure scope and never invents a remote-client service", async () => {
   126	  const result = parsed(await gateway.dispatchGatewayTool("assistant_status", {}, {
   127	    auditCall: false,
   128	    context: { uid: process.getuid?.(), gid: process.getgid?.(), allowRoot: true, workspaceRoot: os.homedir(), home: os.homedir() },
   129	  }));
   130	  assert.equal(result.scope, "metis_infrastructure_only");
   131	  assert.equal(result.remote_devices.status, "not_queried");
   132	  assert.equal(result.remote_devices.discovery_tool, "list_remote_clients");
   133	  assert.equal("devices" in result, false);
   134	  assert.equal("metis-ai-remote-client" in result.services, false);
   135	});
