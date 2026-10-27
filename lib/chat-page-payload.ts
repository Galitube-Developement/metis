import type { ChatMessage, ToolPart } from "@/lib/store";
import { estimateContextTokens } from "@/lib/context-window";
import { enrichToolDisplay, unwrapToolRecord } from "@/lib/tool-call-display";
import { isMemoryScope } from "@/lib/memory-scopes.mjs";
import { editedFileFromTool } from "@/lib/edited-files";

const INLINE_PAYLOAD_LIMIT = 2_048;
const PREVIEW_LENGTH = 256;
const pageCache = new WeakMap<ChatMessage[], { chatId: string; messages: ChatMessage[] }>();

/** Keep JSON arguments valid so paths/targets and native tool captions still work. */
function previewInput(input: string): string {
  try {
    const preview = JSON.stringify(JSON.parse(input), (_key, value) =>
      typeof value === "string" && value.length > PREVIEW_LENGTH ? value.slice(0, PREVIEW_LENGTH) + "…" : value);
    return preview.length <= INLINE_PAYLOAD_LIMIT ? preview : input.slice(0, PREVIEW_LENGTH);
  } catch { return input.slice(0, PREVIEW_LENGTH); }
}

/** Preserve saved mutation identities while the full result remains deferred. */
function previewMutationResult(tool: ToolPart, name: string): string {
  const fallback = tool.result!.slice(0, PREVIEW_LENGTH);
  const action = name.replace(/^.*__/, "").toLowerCase();
  const workspaceType = /^(?:create|edit)_(plan|canvas)$/.exec(action)?.[1];
  if (!workspaceType && !/^(?:add|edit)_memory$/.test(action)) return fallback;
  const outer = unwrapToolRecord(tool.result);
  if (!outer) return fallback;
  const structured = unwrapToolRecord(outer.structuredContent ?? outer.structured_content);
  const record = { ...outer, ...structured };
  const nested = record[workspaceType || "memory"];
  const saved = nested && typeof nested === "object" && !Array.isArray(nested)
    ? { ...record, ...(nested as Record<string, unknown>) } : record;
  const scope = [record.scope, saved.scope].find(isMemoryScope);
  const text = (value: unknown, length = PREVIEW_LENGTH) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, length) : undefined;
  const failed = [outer, structured, saved].find(value => value && (
    value.isError === true || value.error || value.ok === false || value.success === false
    || /^(error|failed|declined|canceled|cancelled)$/i.test(String(value.status || ""))
  ));
  if (failed || /^(error|failed|declined|canceled|cancelled)$/i.test(tool.status)) {
    const error = failed?.error;
    return JSON.stringify({
      isError: true,
      error: text(error) || text(error && typeof error === "object" ? (error as Record<string, unknown>).message : undefined)
        || "Tool operation failed",
      ...(scope ? { scope } : {}),
    });
  }
  if (!/^(completed|success|succeeded|done)$/i.test(tool.status)) return fallback;
  const id = typeof saved.id === "string" && saved.id.trim().length <= 200 ? text(saved.id, 200) : undefined;
  let summary: Record<string, unknown>;
  if (workspaceType) {
    const link = typeof saved.workspaceLink === "string" && saved.workspaceLink.trim().length <= 512
      ? saved.workspaceLink.trim() : undefined;
    const validLink = link?.startsWith(`workspace://${workspaceType}/`) && /^workspace:\/\/(?:plan|canvas)\/[^/?#\s]+$/.test(link);
    if ((!id && !validLink) || (saved.type && saved.type !== workspaceType)) return fallback;
    summary = {
      ...(id ? { id } : {}), type: workspaceType,
      name: text(saved.name ?? saved.title, 200),
      content: text(saved.content),
      workspaceLink: validLink ? link : `workspace://${workspaceType}/${encodeURIComponent(id!)}`,
    };
  } else {
    if (!id) return fallback;
    summary = {
      ...(scope ? { scope } : {}),
      memory: { id, ...(scope ? { scope } : {}), content: text(saved.content ?? saved.text), title: text(saved.title, 200) },
    };
  }
  let preview = JSON.stringify(summary);
  if (preview.length > INLINE_PAYLOAD_LIMIT) {
    delete summary.content;
    delete summary.name;
    if (summary.memory) {
      delete (summary.memory as Record<string, unknown>).content;
      delete (summary.memory as Record<string, unknown>).title;
    }
    preview = JSON.stringify(summary);
  }
  return preview.length <= INLINE_PAYLOAD_LIMIT ? preview : fallback;
}

export function compactChatPageMessages(messages: ChatMessage[], chatId: string): ChatMessage[] {
  const cached = pageCache.get(messages);
  if (cached?.chatId === chatId) return cached.messages;
  const compactMessages = messages.map(message => {
    const compact = <T extends ToolPart>(tool: T): T => {
      const deferResult = typeof tool.result === "string" && tool.result.length > INLINE_PAYLOAD_LIMIT;
      const deferInput = typeof tool.input === "string" && tool.input.length > INLINE_PAYLOAD_LIMIT;
      const deferNested = Boolean(tool.subagent?.messages?.length || tool.subagent?.tools?.length || tool.subagent?.thinking || (tool.subagent?.prompt?.length || 0)>INLINE_PAYLOAD_LIMIT || (tool.subagent?.title?.length || 0)>512 || (tool.diff?.before?.length || 0) + (tool.diff?.after?.length || 0) > INLINE_PAYLOAD_LIMIT);
      if (!tool.id || (!deferResult && !deferInput && !deferNested)) return tool;
      // Known native kinds do not need their multi-megabyte output parsed to
      // discover a name. Gateway wrappers still resolve the inner contract.
      const resolvedName = !/^(mcp|call_mcp_tool|callmcptool)$/i.test(tool.name);
      const knownKind = tool.kind && tool.kind !== "mcp" && tool.kind !== "other";
      const display = enrichToolDisplay({ ...tool, result: resolvedName && knownKind ? undefined : tool.result });
      const url = `/api/chats/${encodeURIComponent(chatId)}/tool-result?messageId=${encodeURIComponent(message.id)}&toolId=${encodeURIComponent(tool.id)}`;
      return {
        ...tool,
        ...(tool.status === "completed" ? { editedFile: editedFileFromTool(tool) } : {}),
        name: display.name,
        kind: display.kind,
        detail: tool.detail?.slice(0,512),
        ...(tool.todos ? {todos:tool.todos.slice(0,20).map(todo=>({...todo,content:todo.content.slice(0,512)}))}:{}),
        ...(deferNested ? { resultUrl: url, subagent: tool.subagent ? { agentId: tool.subagent.agentId, chatId: tool.subagent.chatId, title: tool.subagent.title?.slice(0,512), model: tool.subagent.model, mode: tool.subagent.mode, prompt: tool.subagent.prompt?.slice(0, PREVIEW_LENGTH) } : undefined, diff: tool.diff ? { additions: tool.diff.additions, deletions: tool.diff.deletions } : undefined } : {}),
        ...(deferResult ? { result: previewMutationResult(tool, display.name), resultUrl: url } : {}),
        ...(deferInput ? { input: previewInput(tool.input!), inputUrl: url } : {}),
      };
    };
    return {
      ...message,
      contextTokenEstimate: message.contextTokenEstimate ?? estimateContextTokens({ role: message.role, content: message.content, tools: message.tools || [] }),
      ...(message.tools ? { tools: message.tools.map(compact) } : {}),
      ...(message.parts ? { parts: message.parts.map(part => part.type === "tool" ? compact(part) : part) } : {}),
    };
  });
  pageCache.set(messages, { chatId, messages: compactMessages });
  return compactMessages;
}
