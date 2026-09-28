import type { Chat, ToolPart } from "@/lib/store";

const IMPORTANT_RESULT = /\b(error|failed?|warning|todo|pending|completed|changed|modified|created|wrote|build|deploy|verified|commit|http [2345]\d\d|pass|typecheck)\b|^\s*[MADRCU?]{1,2}\s+\S/i;

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const tail = Math.min(Math.floor(limit / 5), 600);
  return `${value.slice(0, limit - tail - 20)}\n[content omitted]\n${value.slice(-tail)}`;
}

function toolPath(tool: ToolPart): string {
  if (tool.path) return tool.path;
  if (!tool.input) return "";
  try {
    const input = JSON.parse(tool.input) as Record<string, unknown>;
    const nested = input.arguments && typeof input.arguments === "object"
      ? input.arguments as Record<string, unknown>
      : input;
    const path = nested.path || nested.filePath || nested.file_path;
    return typeof path === "string" ? clip(path, 300) : "";
  } catch {
    return "";
  }
}

function resultText(raw: string): string {
  let text = raw;
  for (let depth = 0; depth < 2; depth += 1) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) break;
      if (typeof parsed.stdout === "string" || typeof parsed.stderr === "string") {
        return [parsed.stdout, parsed.stderr].filter((value): value is string => typeof value === "string").join("\n");
      }
      const content = Array.isArray(parsed.content) ? parsed.content : [];
      const first = content.find((item) => item && typeof item === "object" && typeof item.text === "string") as { text?: string } | undefined;
      if (!first?.text) break;
      text = first.text;
    } catch {
      break;
    }
  }
  return text;
}

function toolSummary(tool: ToolPart): string {
  const path = toolPath(tool);
  const label = `${tool.name} (${tool.status})${path ? ` ${path}` : ""}`;
  const todos = tool.todos?.map((todo) => `${todo.status || "pending"}: ${todo.content}`).join("; ");
  if (todos) return `- ${label}: ${clip(todos, 1_000)}`;
  if (!tool.result || tool.kind === "read") return `- ${label}`;
  const lines = resultText(tool.result).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const important = lines.filter((line) => line.length <= 400 && IMPORTANT_RESULT.test(line)).slice(-8);
  const excerpt = important.length ? important.join(" | ") : tool.status === "error" ? lines.slice(-2).join(" | ") : "";
  return excerpt ? `- ${label}: ${clip(excerpt, tool.status === "error" ? 900 : 500)}` : `- ${label}`;
}

function messageEntry(message: Chat["messages"][number], firstUser: boolean, maxChars: number): string {
  const role = message.role === "user" ? "User" : "Assistant";
  const contentLimit = message.role === "user"
    ? (firstUser ? Math.min(20_000, Math.floor(maxChars * 0.25)) : Math.min(8_000, Math.floor(maxChars * 0.2)))
    : Math.min(6_000, Math.floor(maxChars * 0.16));
  const content = clip(message.content.trim(), Math.max(100, contentLimit));
  const tools = message.role === "assistant" && message.tools?.length
    ? clip(message.tools.map(toolSummary).join("\n"), Math.max(100, Math.min(4_000, Math.floor(maxChars * 0.16))))
    : "";
  return `${role}:\n${[content, tools && `Tools already executed:\n${tools}`].filter(Boolean).join("\n")}`;
}

/**
 * Build a bounded native-session recovery checkpoint from durable chat history.
 * User requests survive large tool output, and tool results never consume the
 * entire recovery budget. The saved chat remains the source of truth.
 */
export function recoveryTranscript(
  chat: Pick<Chat, "messages">,
  excludeMessageId?: string,
  maxChars = 120_000,
): string {
  const limit = Math.max(1_000, maxChars);
  const records = chat.messages.filter((message) =>
    message.id !== excludeMessageId
    && (message.role === "user" || message.role === "assistant")
    && Boolean(message.content.trim() || message.tools?.length),
  );
  if (!records.length) return "";
  const firstUserIndex = records.findIndex((message) => message.role === "user");
  const entries = records.map((message, index) => messageEntry(message, index === firstUserIndex, limit));
  const full = entries.join("\n\n");
  if (full.length <= limit) return full;

  const selected = new Set<number>();
  const bodyLimit = limit - 150;
  let used = 0;
  const add = (index: number, budget: number) => {
    const cost = entries[index].length + 2;
    if (used + cost > bodyLimit || cost > budget) return false;
    selected.add(index);
    used += cost;
    return true;
  };
  if (firstUserIndex >= 0) add(firstUserIndex, bodyLimit);
  let userBudget = Math.max(0, Math.floor(limit * 0.55) - used);
  for (let index = entries.length - 1; index >= 0 && userBudget > 0; index -= 1) {
    if (index === firstUserIndex || records[index].role !== "user") continue;
    const cost = entries[index].length + 2;
    if (add(index, userBudget)) userBudget -= cost;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (records[index].role !== "assistant") continue;
    add(index, bodyLimit - used);
  }
  const omitted = records.length - selected.size;
  const header = omitted ? `[Recovery checkpoint: ${omitted} older messages omitted; inspect durable chat history if needed.]\n\n` : "";
  return header + [...selected].sort((a, b) => a - b).map((index) => entries[index]).join("\n\n");
}
