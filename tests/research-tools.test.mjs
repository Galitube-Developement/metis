import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createResearchTools, RESEARCH_TOOLS } from "../lib/mcp-core/research-tools.mjs";

const context = { userId: "owner", chatId: "chat", jobId: "run" };
test("research search/open/find keeps verifiable sources, stable excerpts and isolated durable runs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-"));
  let fetches = 0;
  const research = createResearchTools({ stateDir: root,
    search: async ({ query }) => {
      if (query === "broken") throw new Error("Search unavailable");
      return { results: [{ title: "Primary source", url: "https://example.org/evidence#section", content: "Unverified snippet" }] };
    },
    fetchPages: async () => { fetches++; return { results: [{ ok: true, title: "Official report", content: "Please retain original wording.\nCurrently in order to compare.\nRevenue was 42 EUR.\n" + "x".repeat(600) }] }; },
  });
  try {
    const results = await research("research_search", { queries: ["first", "broken", "second"] }, context);
    assert.equal(results.ok, true);
    assert.equal(results.results[1].ok, false);
    const id = results.results[0].sources[0].sourceId;
    assert.equal(results.results[0].sources[0].opened, false);
    assert.equal(results.results[2].sources[0].sourceId, id);
    await assert.rejects(research("research_find", { source_id: id, query: "42" }, context), /Open this source/);
    const opened = await research("research_open", { source_id: id, line_count: 2 }, context);
    assert.equal(opened.ok, true);
    assert.equal(opened.opened, true);
    assert.equal(opened.citation.url, "https://example.org/evidence");
    assert.equal(opened.hasMore, true);
    assert.match(opened.content, /L1: Please retain original wording/);
    assert.match(opened.content, /L2: Currently in order to compare/);
    assert.ok(opened.retrievedAt);
    const match = await research("research_find", { source_id: id, query: "42 EUR" }, context);
    assert.equal(match.matchCount, 1);
    assert.equal(match.matches[0].line, 3);
    const range = await research("research_open", { source_id: id, start_line: 3, line_count: 2 }, context);
    assert.match(range.content, /L3: Revenue was 42 EUR/);
    assert.equal(fetches, 1, "range reads reuse the same retrieved text");
    const persisted = createResearchTools({ stateDir: root });
    assert.equal((await persisted("research_sources", {}, context)).openedCount, 1);
    for (const foreign of [{ ...context, userId: "other" }, { ...context, chatId: "other" }, { ...context, jobId: "other" }]) {
      await assert.rejects(research("research_open", { source_id: id }, foreign), /Source not found/);
      assert.equal((await research("research_sources", {}, foreign)).openedCount, 0);
    }
    await assert.rejects(research("research_sources", {}, {}), /authenticated chat run/);
    await assert.rejects(research("research_open", { source_id: "../outside" }, context), /Invalid research source/);
    await assert.rejects(research("research_open", { url: "file:///etc/passwd" }, context), /HTTP/);
    await assert.rejects(research("research_open", { url: "https://user:pass@example.org" }, context), /credentials/);
    await assert.rejects(research("research_open", { source_id: id, url: opened.url }, context), /exactly one/);
    await assert.rejects(research("research_open", { source_id: id, start_line: -1 }, context), /integer/);
    await assert.rejects(research("research_search", { queries: [] }, context), /1–5/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blocked pages remain unread and Incognito evidence never reaches disk", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-private-"));
  const research = createResearchTools({ stateDir: root,
    fetchPages: async () => ({ results: [{ ok: false, requiresBrowser: true, error: "Login required" }] }),
  });
  try {
    const privateContext = { ...context, incognito: true };
    const blocked = await research("research_open", { url: "https://example.org/blocked" }, privateContext);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.requiresBrowser, true);
    assert.equal(blocked.opened, false);
    assert.equal((await research("research_sources", {}, privateContext)).openedCount, 0);
    assert.equal((await research("research_sources", {}, privateContext)).sources.length, 1);
    assert.deepEqual(await readdir(root), []);
    assert.equal((await research("research_sources", {}, context)).sources.length, 0);
    assert.deepEqual(RESEARCH_TOOLS.map(t => t.name), ["research_search", "research_open", "research_find", "research_sources"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gateway exposes research tools under the canonical read capability and preserves quotes", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metis-research-gateway-"));
  Object.assign(process.env, { AI_CHAT_ROOT: root, AI_CHAT_MCP_STATE_DIR: root, AI_CHAT_INTERNAL_ORIGIN: "http://127.0.0.1:1" });
  try {
    const { tools, modeToolCategory, dispatchGatewayTool } = await import("../lib/mcp-core/gateway-core.mjs");
    for (const name of RESEARCH_TOOLS.map(t => t.name)) {
      assert.equal(tools.filter(t => t.name === name).length, 1);
      assert.equal(modeToolCategory(name), "read");
    }
    t.mock.method(globalThis, "fetch", async () => Response.json({ results: [{ ok: true, title: "Verbatim", content: "Please retain original wording.\nCurrently in order to compare." }] }));
    const quoted = await dispatchGatewayTool("research_open", { url: "https://example.org/quotes" }, { auditCall: false, context: { ...context, compressionEnabled: true } });
    assert.equal(quoted.isError, undefined);
    assert.match(JSON.parse(quoted.content[0].text).content, /Please retain original wording/);
    assert.match(JSON.parse(quoted.content[0].text).content, /Currently in order to compare/);
    const result = await dispatchGatewayTool("research_sources", {}, { auditCall: false, context: { ...context, modePolicy: JSON.stringify({ allowedCategories: ["read"] }) } });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).openedCount, 1);
    const denied = await dispatchGatewayTool("research_sources", {}, { auditCall: false, context: { ...context, modePolicy: JSON.stringify({ allowedCategories: [] }) } });
    assert.equal(denied.isError, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
