import { getChat, getGlobalModelSettings } from "@/lib/db-store";
import { listNotes, getNote } from "@/lib/shared-context";

export type ReferenceKind = "file" | "canvas" | "plan" | "note" | "browser" | "memory" | "chat" | "terminal";

export type ContextReference = {
  kind: ReferenceKind;
  id: string;
  label: string;
  source?: "explicit" | "pinned";
  detail?: string;
  chatId?: string;
  path?: string;
  content?: string;
};

export function getPinnedNoteIds(ownerId: string | undefined, chatId: string) {
  const global = getGlobalModelSettings(ownerId).pinnedNoteIds || [];
  const session = getChat(chatId, ownerId)?.sessionState;
  const excluded = new Set(session?.unpinnedGlobalNoteIds || []);
  const chat = session?.pinnedNoteIds || [];
  return [...new Set([...global.filter((id) => !excluded.has(id)), ...chat])].slice(0, 20);
}

export function getPinnedNotes(ownerId: string | undefined, chatId: string) {
  const chat = getChat(chatId, ownerId);
  if (!chat || chat.incognito) return [];
  ownerId ??= chat.ownerId;
  const allowed = new Map(listNotes({ ownerId, chatId }).filter((note) => note.ownerId === ownerId).map((note) => [note.id, note]));
  return getPinnedNoteIds(ownerId, chatId)
    .map((id) => allowed.get(id))
    .filter((note): note is NonNullable<typeof note> => Boolean(note))
    .map((note): ContextReference => ({
      kind: "note",
      id: note.id,
      label: note.title || "Untitled note",
      detail: "Pinned note",
      chatId: note.chatId,
      content: note.content.slice(0, 8_000),
      source: "pinned",
    }));
}

export function resolveReferences(
  ownerId: string | undefined,
  chatId: string,
  references: ContextReference[],
) {
  const chat = getChat(chatId, ownerId);
  if (!chat) return [];
  const resolvedOwnerId = ownerId ?? chat.ownerId;
  const accessibleNotes = new Map(listNotes({ ownerId: resolvedOwnerId, chatId }).filter((note) => note.ownerId === resolvedOwnerId).map((note) => [note.id, note]));
  return references
    .slice(0, 20)
    .map((reference): ContextReference | null => {
      if (reference.kind !== "note") return { ...reference, source: reference.source || "explicit" };
      const note = accessibleNotes.get(reference.id) || getNote(reference.id, resolvedOwnerId, { chatId });
      if (!note || note.ownerId !== resolvedOwnerId) return null;
      return {
        kind: "note",
        id: note.id,
        label: note.title || "Untitled note",
        detail: reference.detail || "Referenced note",
        chatId: note.chatId,
        content: note.content.slice(0, 8_000),
        source: reference.source || "explicit",
      };
    })
    .filter((reference): reference is ContextReference => Boolean(reference));
}

