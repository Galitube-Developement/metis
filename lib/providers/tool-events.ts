import { classifyToolKind } from "@/lib/tool-call-display";
import type { ToolPart } from "@/lib/store";

const GATEWAY_HINT = /^(browser_|context_|list_|read_|write_|edit_|execute_|search_|call_mcp|delegate_|verify_work|ledger_|audio_fingerprint|write_todos|update_chat|create_plan|edit_plan|create_note|create_automation)/i;

export function canonicalizeToolPart(tool: ToolPart): ToolPart {
  const name = (tool.name || "tool").trim() || "tool";
  const kind = tool.kind || classifyToolKind(name, tool.input, tool.result);
  const source = tool.source
    || (name.startsWith("mcp__") || kind === "mcp" || kind === "browser" || GATEWAY_HINT.test(name) ? "mcp" : "native");
  return {
    ...tool,
    id: tool.id || crypto.randomUUID(),
    name,
    kind,
    source,
    status: tool.status || "running",
  };
}
