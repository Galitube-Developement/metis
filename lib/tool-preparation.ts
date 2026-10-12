import { classifyToolKind, isToolRunning } from "./tool-call-display";

export type PreparingTool = {
  id?: string;
  name: string;
  kind?: string;
  source?: "mcp" | "native" | "browser";
  phase?: string;
  inputChars?: number;
  status?: string;
  result?: unknown;
};

export function toolPreparationLabel(kind?: string) {
  return kind === "read" ? "Preparing file read" : kind === "shell" ? "Preparing command"
    : kind === "edit" ? "Preparing file edit" : "Preparing tool call";
}

export function toolPreparationIdentity(tool: Pick<PreparingTool, "name" | "kind" | "source">) {
  const name = tool.name.trim();
  const mcp = tool.source === "mcp" || (!tool.source && (tool.kind === "mcp" || name.startsWith("mcp__")));
  return name && name !== "tool" ? `${mcp ? "MCP · " : ""}${name}` : mcp ? "MCP" : "";
}

export function toolPreparationTitle(tool: Pick<PreparingTool, "name" | "kind" | "source">) {
  const label = toolPreparationLabel(tool.kind || classifyToolKind(tool.name));
  const identity = toolPreparationIdentity(tool);
  return identity ? `${label} · ${identity}` : label;
}

/** Counts describe received arguments only; absent telemetry remains absent. */
export function toolPreparationCharacters(value?: number) {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Latest pending call wins; stale completed/error/result-bearing tools never count. */
export function latestPreparingTool(tools: ReadonlyArray<PreparingTool>) {
  return tools.findLast(tool => tool.phase === "preparing" && isToolRunning(tool.status || "") && tool.result === undefined);
}
