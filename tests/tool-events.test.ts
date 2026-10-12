import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeToolPart } from "../lib/providers/tool-events";
import { providerExecution } from "../lib/providers/run-kind";
import { listProviderDefinitions } from "../lib/providers/registry";

test("canonicalizeToolPart marks gateway tools as mcp source", () => {
  const tool = canonicalizeToolPart({ id: "1", name: "list_directory", status: "running" });
  assert.equal(tool.kind, "read");
  assert.equal(tool.source, "mcp");
  assert.equal(canonicalizeToolPart({ id: "t", name: "write_todos", status: "running" }).source, "mcp");
  assert.equal(canonicalizeToolPart({ id: "e", name: "execute_command", status: "running" }).source, "mcp");
});

test("canonicalizeToolPart keeps native provider tools native", () => {
  const tool = canonicalizeToolPart({ id: "2", name: "ApplyPatch", status: "completed" });
  assert.equal(tool.source, "native");
});

test("grok-build and opencode route to CLI runtimes with MCP", () => {
  assert.equal(providerExecution("grok-build"), "grok-cli");
  assert.equal(providerExecution("opencode"), "opencode-cli");
  for (const key of ["grok-build", "opencode"]) {
    const provider = listProviderDefinitions().find((item) => item.key === key);
    assert.ok(provider);
    assert.equal(provider?.capabilities.mcp, true);
    assert.equal(provider?.capabilities.tools, true);
  }
});


test("MCP-prefixed reads retain their transport after semantic classification", () => {
  const tool = canonicalizeToolPart({ id: "mcp-read", name: "mcp__custom__read_file", status: "running" });
  assert.equal(tool.kind, "read");
  assert.equal(tool.source, "mcp");
});
