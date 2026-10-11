import { payloadRecord, payloadText } from "@/lib/agent-payload";
import { classifyToolKind } from "@/lib/tool-call-display";

const asRecord = (value: unknown) => payloadRecord(value, 3);
const asText = (value: unknown) => payloadText(value, 3);

export { classifyToolKind as classifyTranscriptTool } from "@/lib/tool-call-display";

export type TranscriptTool = {
  id: string;
  name: string;
  status: string;
  kind?: "plan" | "edit" | "read" | "shell" | "subagent" | "mcp" | "canvas" | "note" | "todo" | "browser" | "memory" | "automation" | "compaction" | "other";
  path?: string;
  input?: string;
  result?: string;
};

export type TranscriptMessage = {
  role: string;
  text: string;
};

export type TranscriptPart =
  | { type: "thinking"; text: string }
  | { type: "message"; role: string; text: string }
  | { type: "tool"; tool: TranscriptTool };

export type AgentTranscript = {
  thinking: string;
  messages: TranscriptMessage[];
  tools: TranscriptTool[];
  parts: TranscriptPart[];
};

const DUMP_LINE =
  /^\s*(thinkingMessage|assistantMessage|userMessage|conversationSteps|readToolCall|editToolCall|grepToolCall|shellToolCall)\s*:/m;
const DUMP_TOKEN = /thinkingMessage|assistantMessage|conversationSteps|readToolCall/;
const TOOL_CALL_KEY = /^(.*)ToolCall$/;
const MAX_NESTED_RESULT = 4_000;

function compactJson(value: unknown, max = MAX_NESTED_RESULT): string | undefined {
  if (value == null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…[truncated ${text.length - max} chars]` : text;
}

function unwrapCursorToolCall(raw: unknown, index: number): TranscriptTool | null {
  const record = asRecord(raw);
  const nestedKey = Object.keys(record).find((key) => TOOL_CALL_KEY.test(key) && key !== "toolCall");
  const payload = nestedKey ? asRecord(record[nestedKey]) : record;
  const nameFromKey = nestedKey?.match(TOOL_CALL_KEY)?.[1];
  const name =
    (typeof payload.name === "string" && payload.name) ||
    (typeof payload.toolName === "string" && payload.toolName) ||
    (typeof record.name === "string" && record.name) ||
    nameFromKey ||
    "";
  if (!name) return null;
  const args = payload.args ?? payload.input ?? payload.arguments ?? record.args ?? record.input;
  const result = payload.result ?? payload.output ?? payload.content ?? record.result;
  const argRecord = asRecord(args);
  const path = typeof argRecord.path === "string" ? argRecord.path : undefined;
  const id =
    (typeof record.toolCallId === "string" && record.toolCallId) ||
    (typeof payload.id === "string" && payload.id) ||
    (typeof record.id === "string" && record.id) ||
    `${name}-${index}`;
  const status =
    (typeof payload.status === "string" && payload.status) ||
    (typeof record.status === "string" && record.status) ||
    (result != null ? "completed" : "running");
  const kind = classifyToolKind(name, args, result);
  return {
    id,
    name,
    status,
    kind,
    ...(path ? { path } : {}),
    ...(args !== undefined ? { input: compactJson(args, 2_000) } : {}),
    ...(result !== undefined && kind !== "read" ? { result: compactJson(result) } : {}),
  };
}

function stepTools(item: Record<string, unknown>, index: number): TranscriptTool[] {
  const candidates = Array.isArray(item.tools)
    ? item.tools
    : item.toolCall || item.tool_call || item.tool
      ? [item.toolCall || item.tool_call || item.tool]
      : Object.keys(item).some((key) => TOOL_CALL_KEY.test(key))
        ? [item]
        : [];
  return candidates
    .map((candidate, offset) => unwrapCursorToolCall(candidate, index + offset))
    .filter((tool): tool is TranscriptTool => Boolean(tool));
}

function assistantTextFromStep(item: Record<string, unknown>): { role: string; text: string } | null {
  const role = typeof item.role === "string"
    ? item.role
    : item.userMessage
      ? "user"
      : "assistant";
  const text = asText(
    item.assistantMessage ??
      item.userMessage ??
      item.text ??
      item.content ??
      item.message ??
      item.response ??
      item.answer,
  ).trim();
  if (!text || looksLikeTranscriptDump(text)) return null;
  return { role, text };
}

function labeledDumpHits(value: string): number {
  return [...value.matchAll(new RegExp(DUMP_LINE.source, "gm"))].length;
}

function unwrapJson(value: unknown, depth = 0): unknown {
  if (depth > 3 || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("\""))) return value;
  try {
    return unwrapJson(JSON.parse(trimmed), depth + 1);
  } catch {
    return value;
  }
}

export function looksLikeTranscriptDump(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (labeledDumpHits(trimmed) >= 2 && DUMP_TOKEN.test(trimmed)) return true;
  const unwrapped = unwrapJson(trimmed);
  const record = unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
    ? unwrapped as Record<string, unknown>
    : null;
  const nested = record?.value && typeof record.value === "object" && !Array.isArray(record.value)
    ? record.value as Record<string, unknown>
    : record;
  return Boolean(nested && Array.isArray(nested.conversationSteps));
}

export function stripTranscriptDump(content: string): string {
  if (!content) return "";
  if (looksLikeTranscriptDump(content)) {
    const marker = content.search(DUMP_LINE);
    return marker > 0 ? content.slice(0, marker).trim() : "";
  }
  const marker = content.search(DUMP_LINE);
  if (marker <= 0) return content;
  const rest = content.slice(marker);
  return looksLikeTranscriptDump(rest) ? content.slice(0, marker).trim() : content;
}

function emptyTranscript(): AgentTranscript {
  return { thinking: "", messages: [], tools: [], parts: [] };
}

export function parseAgentTranscript(value: unknown): AgentTranscript {
  const transcript = emptyTranscript();
  const unwrapped = unwrapJson(value);
  const root = asRecord(unwrapped);
  const nested = asRecord(root.value);
  const steps = Array.isArray(nested.conversationSteps)
    ? nested.conversationSteps
    : Array.isArray(root.conversationSteps)
      ? root.conversationSteps
      : Array.isArray(nested.messages)
        ? nested.messages
        : Array.isArray(root.messages)
          ? root.messages
          : Array.isArray(unwrapped)
            ? unwrapped
            : [];
  steps.forEach((step, index) => {
    const item = asRecord(step);
    const thinkingText = asText(item.thinkingMessage ?? item.thinking ?? item.reasoning).trim();
    if (thinkingText && !looksLikeTranscriptDump(thinkingText)) {
      transcript.thinking += `${transcript.thinking ? "\n\n" : ""}${thinkingText}`;
      transcript.parts.push({ type: "thinking", text: thinkingText });
    }
    const message = assistantTextFromStep(item);
    if (message) {
      transcript.messages.push(message);
      transcript.parts.push({ type: "message", ...message });
    }
    for (const tool of stepTools(item, index)) {
      transcript.tools.push(tool);
      transcript.parts.push({ type: "tool", tool });
    }
  });
  return transcript;
}

export function transcriptFromToolPart(tool: {
  result?: unknown;
  detail?: string;
  input?: string;
  subagent?: {
    thinking?: string;
    messages?: TranscriptMessage[];
    tools?: TranscriptTool[];
  };
}): AgentTranscript {
  const parsed = parseAgentTranscript(tool.result);
  if (parsed.parts.length) return parsed;
  const thinking = tool.subagent?.thinking?.trim() || "";
  const messages = (tool.subagent?.messages || []).filter((message) => {
    const text = message.text?.trim();
    return Boolean(text) && !looksLikeTranscriptDump(text);
  });
  const tools = tool.subagent?.tools || [];
  const parts: TranscriptPart[] = [];
  if (thinking) parts.push({ type: "thinking", text: thinking });
  for (const message of messages) parts.push({ type: "message", role: message.role, text: message.text });
  for (const nested of tools) parts.push({ type: "tool", tool: nested });
  return { thinking, messages, tools, parts };
}
