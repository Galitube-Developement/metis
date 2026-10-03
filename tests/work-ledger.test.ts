     1	import assert from "node:assert/strict";
     2	import test from "node:test";
     3	import { spawn } from "node:child_process";
     4	import os from "node:os";
     5	import {
     6	  normalizeClaims,
     7	  evaluateClaim,
     8	  recordVerified,
     9	  ledgerSummary,
    10	  compactReport,
    11	} from "../lib/mcp-core/work-ledger.mjs";
    12	import { CORE_MCP_TOOL_ALLOWLIST } from "../lib/mcp-bridge";
    13	
    14	test("verify_work + ledger tools are declared in the bridge allowlist", () => {
    15	  assert.ok(CORE_MCP_TOOL_ALLOWLIST.includes("verify_work"));
    16	  assert.ok(CORE_MCP_TOOL_ALLOWLIST.includes("ledger_review"));
    17	  assert.ok(CORE_MCP_TOOL_ALLOWLIST.includes("audio_fingerprint"));
    18	});
    19	
    20	test("normalizeClaims validates shape and enforces caps", () => {
    21	  const { claims, errors } = normalizeClaims([
    22	    { label: "tests pass", command: "pnpm test", expect: ["pass"], reject: ["fail"], timeout: 90 },
    23	    { label: "", command: "ls" },
    24	    { command: "ls" },
    25	    "junk",
    26	    { label: "big", command: "ls", timeout: 9999 },
    27	  ]);
    28	  assert.equal(errors.length, 3);
    29	  assert.equal(claims.length, 2);
    30	  assert.equal(claims[0]?.expect?.length, 1);
    31	  assert.equal(claims[1]?.timeout, 120); // clamped
    32	});
    33	
    34	test("evaluateClaim verifies against real runShell result shape", () => {
    35	  const claim = { label: "echo", command: "echo hello", expect: ["hello"], reject: ["boom"], target: "server" };
    36	  const ok = evaluateClaim(claim, { exit_code: 0, stdout: "hello\n", stderr: "" });
    37	  assert.equal(ok.verified, true);
    38	  assert.deepEqual(ok.matched, ["hello"]);
    39	  const badExit = evaluateClaim(claim, { exit_code: 1, stdout: "hello\n", stderr: "" });
    40	  assert.equal(badExit.verified, false);
    41	  const missingMarker = evaluateClaim(claim, { exit_code: 0, stdout: "world\n", stderr: "" });
    42	  assert.equal(missingMarker.verified, false);
    43	  assert.deepEqual(missingMarker.missing, ["hello"]);
    44	  const rejectedMarker = evaluateClaim(claim, { exit_code: 0, stdout: "hello boom\n", stderr: "" });
    45	  assert.equal(rejectedMarker.verified, false);
    46	  assert.deepEqual(rejectedMarker.foundRejected, ["boom"]);
    47	});
    48	
    49	test("ledger records and reviews entries per job context", () => {
    50	  const context = { jobId: "job-test-1", chatId: "chat-1" };
    51	  const entries = [
    52	    { label: "a", command: "true", target: "server", verified: true, exitCode: 0 },
    53	    { label: "b", command: "false", target: "server", verified: false, exitCode: 1 },
    54	  ];
    55	  const record = recordVerified(undefined, context, entries);
    56	  assert.ok(record);
    57	  assert.equal(record.entries.length, 2);
    58	  const summary = ledgerSummary(context);
    59	  assert.equal(summary.exists, true);
    60	  assert.equal(summary.verified, 1);
    61	  assert.equal(summary.failed, 1);
    62	  const other = ledgerSummary({ jobId: "job-test-2" });
    63	  assert.equal(other.exists, false);
    64	});
    65	
    66	test("compactReport summarizes verification outcome", () => {
    67	  const report = compactReport([
    68	    { label: "ok", command: "true", verified: true, exitCode: 0 },
    69	    { label: "bad", command: "false", verified: false, exitCode: 1, missing: ["x"] },
    70	  ]);
    71	  assert.equal(report.allVerified, false);
    72	  assert.equal(report.verified, 1);
    73	  assert.match(report.report, /VERIFIED {2}ok/);
    74	  assert.match(report.report, /FAILED {2}bad/);
    75	});
    76	
    77	// ---------------------------------------------------------------------------
    78	// E2E over the real stdio MCP server (top-level await in gateway-core.mjs
    79	// prevents direct CJS import in tests — the server is spawned instead).
    80	// ---------------------------------------------------------------------------
    81	
    82	type Line = { jsonrpc: string; id?: number; result?: unknown; error?: unknown };
    83	
    84	function startGateway() {
    85	  const child = spawn("node", ["--experimental-vm-modules", "lib/internal-mcp-server.mjs"], {
    86	    cwd: process.cwd(),
    87	    env: {
    88	      ...process.env,
    89	      AI_CHAT_INTERNAL_ORIGIN: "http://127.0.0.1:4000",
    90	      MCP_AGENT_CWD: os.homedir(),
    91	      MCP_OS_UID: String(process.getuid?.() ?? 0),
    92	      MCP_OS_GID: String(process.getgid?.() ?? 0),
    93	      MCP_ALLOW_ROOT_AGENTS: "1",
    94	    },
    95	    stdio: ["pipe", "pipe", "pipe"],
    96	  });
    97	  let buf = "";
    98	  const pending = new Map<number, (value: Line) => void>();
    99	  child.stdout.on("data", (chunk) => {
   100	    buf += chunk.toString();
   101	    let idx: number;
   102	    while ((idx = buf.indexOf("\n")) >= 0) {
   103	      const line = buf.slice(0, idx).trim();
   104	      buf = buf.slice(idx + 1);
   105	      if (!line) continue;
   106	      try {
   107	        const msg = JSON.parse(line) as Line;
   108	        if (msg.id !== undefined && pending.has(msg.id)) {
   109	          pending.get(msg.id)!(msg);
   110	          pending.delete(msg.id);
   111	        }
   112	      } catch {
   113	        /* non-JSON line (stderr-like noise) */
   114	      }
   115	    }
   116	  });
   117	  const collected: string[] = [];
   118	  child.stderr.on("data", (d) => collected.push(d.toString()));
   119	  let nextId = 1;
   120	  const call = (method: string, params: Record<string, unknown> = {}) =>
   121	    new Promise<Line>((resolve, reject) => {
   122	      const id = nextId++;
   123	      pending.set(id, resolve);
   124	      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
   125	      setTimeout(() => {
   126	        if (pending.has(id)) {
   127	          pending.delete(id);
   128	          reject(new Error(`timeout waiting for ${method} (stderr: ${collected.slice(-5).join("").slice(0, 300)})`));
   129	        }
   130	      }, 30_000);
   131	    });
   132	  const notify = (method: string) =>
   133	    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
   134	  return { child, call, notify };
   135	}
   136	
   137	test("stdio gateway exposes and executes the new tools end-to-end", async () => {
   138	  const gateway = startGateway();
   139	  try {
   140	    const init = await gateway.call("initialize", {
   141	      protocolVersion: "2025-06-18",
   142	      capabilities: {},
   143	      clientInfo: { name: "work-ledger-test", version: "1.0" },
   144	    });
   145	    assert.ok(init.result, "initialize must succeed");
   146	    gateway.notify("notifications/initialized");
   147	
   148	    const list = await gateway.call("tools/list");
   149	    const tools = (list.result as { tools?: Array<{ name: string }> }).tools || [];
   150	    const names = tools.map((tool) => tool.name);
   151	    assert.ok(names.includes("verify_work"), "verify_work must be listed");
   152	    assert.ok(names.includes("ledger_review"), "ledger_review must be listed");
   153	    assert.ok(names.includes("audio_fingerprint"), "audio_fingerprint must be listed");
   154	
   155	    const verify = await gateway.call("tools/call", {
   156	      name: "verify_work",
   157	      arguments: {
   158	        claims: [
   159	          { label: "echo marker works", command: "echo proof-of-work-ok", expect: ["proof-of-work-ok"] },
   160	          { label: "missing marker fails", command: "echo something-else", expect: ["never-appears"] },
   161	        ],
   162	      },
   163	    });
   164	    const verifyText = (verify.result as { content: Array<{ text: string }> }).content[0].text;
   165	    const payload = JSON.parse(verifyText);
   166	    assert.equal(payload.total, 2);
   167	    assert.equal(payload.verified, 1);
   168	    assert.equal(payload.allVerified, false);
   169	    assert.equal(payload.results[0].verified, true);
   170	    assert.equal(payload.results[1].verified, false);
   171	
   172	    const stats = await gateway.call("tools/call", {
   173	      name: "audio_fingerprint",
   174	      arguments: { action: "stats" },
   175	    });
   176	    const statsText = (stats.result as { content: Array<{ text: string }> }).content[0].text;
   177	    const statsPayload = JSON.parse(statsText);
   178	    assert.equal(statsPayload.ok, true);
   179	    assert.equal(typeof statsPayload.tracks, "number");
   180	
   181	    const invalid = await gateway.call("tools/call", {
   182	      name: "audio_fingerprint",
   183	      arguments: { action: "match" },
   184	    });
   185	    const invalidResult = invalid.result as { isError?: boolean; content?: Array<{ text: string }> };
   186	    assert.ok(
   187	      invalidResult?.isError || invalid.error,
   188	      "match without audio must fail (isError or JSON-RPC error)",
   189	    );
   190	    const invalidText = invalidResult?.content?.[0]?.text || JSON.stringify(invalid.error || {});
   191	    assert.match(invalidText, /audio is required/i);
   192	  } finally {
   193	    gateway.child.kill();
   194	  }
   195	});
