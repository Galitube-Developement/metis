import { getChat, type WorkspaceItem } from "@/lib/db-store";
import { getDatabase } from "@/lib/sqlite";

export type InternalWorkspaceTarget = { kind: WorkspaceItem["type"]; id: string };
export type InternalWorkspace = { chatId: string; workspace: WorkspaceItem };

/** Resolve a workspace without guessing between repeated IDs in different chats. */
export function getInternalWorkspace(
  target: InternalWorkspaceTarget,
  ownerId: string,
  chatId?: string,
): InternalWorkspace | null {
  // Never let an absent account widen the canonical store's optional owner filter.
  if (!ownerId) return null;
  const legacyCanvas = target.kind === "canvas" && target.id === "canvas-default";
  let resolvedChatId = chatId;
  if (resolvedChatId === undefined) {
    // Some IDs (notably canvas-default) repeat across chats. A context-free
    // request is only safe when exactly one owned chat contains that target.
    const matches = getDatabase().prepare(`
      SELECT c.id FROM chats AS c
      WHERE c.owner_id = ? AND (
        EXISTS (
          SELECT 1 FROM json_each(c.data, '$.workspaces') AS workspace
          WHERE json_extract(workspace.value, '$.id') = ?
            AND json_extract(workspace.value, '$.type') = ?
        ) OR (
          ? = 1 AND COALESCE(json_array_length(c.data, '$.workspaces'), 0) = 0
            AND json_type(c.data, '$.canvas') = 'text'
            AND length(json_extract(c.data, '$.canvas')) > 0
        )
      )
      LIMIT 2
    `).all(ownerId, target.id, target.kind, legacyCanvas ? 1 : 0) as Array<{ id: string }>;
    if (matches.length !== 1) return null;
    resolvedChatId = matches[0].id;
  }
  // An explicit chat must never fall back to another chat with the same ID.
  // getChat retains its ownership, cache and expired-incognito checks.
  const chat = getChat(resolvedChatId, ownerId);
  if (!chat) return null;
  const workspace = Array.isArray(chat.workspaces) && chat.workspaces.length
    ? chat.workspaces.find(item => item.id === target.id && item.type === target.kind)
    : legacyCanvas && chat.canvas ? {
      id: "canvas-default", type: "canvas" as const, name: "Canvas", content: chat.canvas,
      createdAt: chat.createdAt, updatedAt: chat.updatedAt,
    } : undefined;
  return workspace ? { chatId: chat.id, workspace } : null;
}
