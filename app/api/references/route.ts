import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChat, listChatsForUser, listMemories } from "@/lib/db-store";
import { config } from "@/lib/config";
import { listNotes } from "@/lib/shared-context";
import { referenceMatches, REFERENCE_KINDS } from "@/lib/reference-search";
import { editedFilesForMessage } from "@/lib/edited-files";
import { unwrapToolRecord } from "@/lib/tool-call-display";
import { canAccessChat } from "@/lib/project-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReferenceKind = "file" | "canvas" | "plan" | "note" | "browser" | "memory" | "chat" | "terminal";

type ReferenceResult = {
  kind: ReferenceKind;
  id: string;
  label: string;
  detail?: string;
  chatId?: string;
  isCurrentChat?: boolean;
  path?: string;
  content?: string;
  sessionId?: string;
};

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 200);
  const kind = url.searchParams.get("kind") as ReferenceKind | null;
  const currentChatId = url.searchParams.get("chatId") || "";
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  if (!ownerId) return Response.json({ error: "Account context required" }, { status: 401 });
  if (kind && !(REFERENCE_KINDS as readonly string[]).includes(kind)) return Response.json({ error: "Unknown reference category" }, { status: 400 });
  const results: ReferenceResult[] = [];

  const push = (item: ReferenceResult) => {
    if ((!kind || item.kind === kind) && referenceMatches(query, item.label, item.detail, item.path, item.content)) {
      results.push(item);
    }
  };

  const chatEntries = kind === "note" || kind === "memory" ? [] : listChatsForUser(ownerId);
  for (const entry of chatEntries) {
    if (kind === "chat") {
      push({ kind: "chat", id: entry.id, label: entry.title || "Untitled chat", detail: entry.keywords?.join(" · "), chatId: entry.id, isCurrentChat: entry.id === currentChatId });
      continue;
    }
    const chat = getChat(entry.id, ownerId);
    if (!chat) continue;
    push({
      kind: "chat",
      id: chat.id,
      label: chat.title || "Untitled chat",
      detail: `${chat.messages.length} messages${chat.keywords?.length ? ` · ${chat.keywords.join(" · ")}` : ""}`,
      chatId: chat.id,
      isCurrentChat: chat.id === currentChatId,
    });

    for (const workspace of chat.workspaces || []) {
      push({
        kind: workspace.type,
        id: workspace.id,
        label: workspace.name,
        detail: `in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        content: workspace.content.slice(0, 6_000),
      });
    }

    for (const tab of chat.browserContext?.tabs || []) {
      if (!tab.url && tab.title === "New tab") continue;
      push({
        kind: "browser",
        id: `${chat.id}:${tab.id}`,
        label: tab.title || tab.url || "Browser tab",
        detail: tab.url || `in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: tab.url,
      });
    }

    for (const tab of chat.sessionState?.terminalTabs || []) {
      push({
        kind: "terminal",
        id: `${chat.id}:${tab.id}`,
        label: tab.title || "Terminal",
        detail: `${tab.cwd} · in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: tab.cwd,
        sessionId: tab.sessionId,
      });
    }
    if (!chat.sessionState?.terminalTabs?.length && chat.sessionState?.terminalSessionId) {
      push({
        kind: "terminal",
        id: `${chat.id}:terminal-1`,
        label: "Terminal 1",
        detail: `${chat.sessionState.terminalCwd || chat.sessionState.remoteCwd || config.agentCwd} · in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: chat.sessionState.terminalCwd || chat.sessionState.remoteCwd || config.agentCwd,
        sessionId: chat.sessionState.terminalSessionId,
      });
    }

    if (kind && kind !== "file") continue;
    for (const message of chat.messages) {
      for (const edited of editedFilesForMessage(message)) push({
        kind: "file", id: `${chat.id}:${edited.target}:${edited.path}`, label: edited.path.split(/[\\\\/]/).pop() || edited.path,
        detail: `${edited.target} · in ${chat.title || "Untitled chat"}`, chatId: chat.id, isCurrentChat: chat.id === currentChatId, path: edited.path,
      });
      for (const attachment of message.attachments || []) {
        push({
          kind: "file",
          id: `${chat.id}:${attachment.id}`,
          label: attachment.name,
          detail: `in ${chat.title || "Untitled chat"}`,
          chatId: chat.id,
          isCurrentChat: chat.id === currentChatId,
          path: attachment.storedName,
        });
      }
      for (const tool of message.tools || []) {
        const args = unwrapToolRecord(tool.input);
        const path = tool.path || [args?.path, args?.filePath, args?.file_path].find((value): value is string => typeof value === "string");
        if (!path) continue;
        push({
          kind: "file",
          id: `${chat.id}:${tool.id}`,
          label: path.split(/[\\\\/]/).pop() || path,
          detail: tool.name,
          chatId: chat.id,
          isCurrentChat: chat.id === currentChatId,
          path,
          content: (typeof tool.result === "string" ? tool.result : tool.detail || "").slice(0, 6_000),
        });
      }
    }
  }

  if (!kind || kind === "memory") {
    for (const memory of listMemories(ownerId)) {
      push({
        kind: "memory",
        id: memory.id,
        label: memory.content.slice(0, 160),
        detail: memory.tags?.join(" · "),
        content: memory.content,
      });
    }
  }

  if (!kind || kind === "note" || kind === "memory") {
    for (const note of listNotes({ ownerId })) {
      if (note.chatId && !canAccessChat(note.chatId, ownerId)) continue;
      push({
        kind: note.kind === "learned_fact" ? "memory" : "note",
        id: note.id,
        label: note.title || note.content.slice(0, 80) || "Untitled note",
        detail: note.projectId ? "Project context" : note.chatId ? "Chat context" : note.scope === "workspace" ? "Workspace context" : "Global context",
        ...(note.chatId ? { chatId: note.chatId, isCurrentChat: note.chatId === currentChatId } : {}),
        content: note.content.slice(0, 6_000),
      });
    }
  }

  const seen = new Set<string>();
  const unique = results.sort((a, b) => Number(Boolean(b.isCurrentChat)) - Number(Boolean(a.isCurrentChat))).filter(item => {
    const key = item.kind === "file" ? [item.kind, item.chatId, item.path].join(":") : [item.kind, item.id, item.chatId || ""].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return Response.json({ results: unique.slice(0, 80), currentChatId }, { headers: { "Cache-Control": "private, no-store" } });
}
