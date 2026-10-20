import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChat, getChatNotePins, getGlobalModelSettings, listChatsForUser, saveGlobalModelSettings, updateChat } from "@/lib/db-store";
import { listNotes } from "@/lib/shared-context";
import { getPinnedNoteIds } from "@/lib/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noteIds(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim().slice(0, 120)))].slice(0, 20)
    : [];
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const chatId = new URL(req.url).searchParams.get("chatId")?.trim() || "";
  const noteId = new URL(req.url).searchParams.get("noteId")?.trim() || "";
  const chatPins = chatId ? getChatNotePins(chatId, ownerId) : null;
  if (chatId && !chatPins) return Response.json({ error: "Chat not found" }, { status: 404 });
  const globalNoteIds = getGlobalModelSettings(ownerId).pinnedNoteIds || [];
  const chatNoteIds = chatPins?.pinnedNoteIds || [];
  const notes = listNotes({ ownerId, chatId: chatId || undefined });
  const chats = listChatsForUser(ownerId);
  const configuredChatIds = noteId
    ? chats.filter((chat) => getPinnedNoteIds(ownerId, chat.id).includes(noteId)).map((chat) => chat.id)
    : [];
  const configuredNoteIds = [...new Set(chats.flatMap((chat) => getChatNotePins(chat.id, ownerId)?.pinnedNoteIds || []))];
  return Response.json({
    globalNoteIds,
    chatNoteIds,
    pinnedNoteIds: chatId ? getPinnedNoteIds(ownerId, chatId) : globalNoteIds,
    notes,
    chats: chats.map((chat) => ({ id: chat.id, title: chat.title || "Untitled chat" })),
    configuredChatIds,
    configuredNoteIds,
  });
}

export async function PATCH(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const body = (await req.json().catch(() => ({}))) as {
    chatId?: unknown;
    scope?: unknown;
    noteIds?: unknown;
    noteId?: unknown;
    everywhere?: unknown;
    chatIds?: unknown;
  };
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  const noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";
  if (noteId) {
    if (!listNotes({ ownerId }).some((note) => note.id === noteId)) {
      return Response.json({ error: "Note not found" }, { status: 404 });
    }
    const selectedChatIds = noteIds(body.chatIds);
    const chats = listChatsForUser(ownerId);
    const validChatIds = new Set(chats.map((chat) => chat.id));
    const targetChatIds = body.everywhere === true
      ? chats.map((chat) => chat.id)
      : selectedChatIds.filter((id) => validChatIds.has(id));
    const settings = getGlobalModelSettings(ownerId);
    saveGlobalModelSettings({
      ...settings,
      pinnedNoteIds: body.everywhere === true
        ? [...new Set([...(settings.pinnedNoteIds || []), noteId])].slice(0, 20)
        : (settings.pinnedNoteIds || []).filter((id) => id !== noteId),
    }, ownerId);
    for (const chat of chats) {
      const existingChat = getChat(chat.id, ownerId);
      const current = existingChat?.sessionState?.pinnedNoteIds || [];
      const next = targetChatIds.includes(chat.id)
        ? [...new Set([...current, noteId])].slice(-20)
        : current.filter((id) => id !== noteId);
      updateChat(chat.id, {
        sessionState: { ...(existingChat?.sessionState || {}), pinnedNoteIds: next },
        touchUpdatedAt: false,
      }, ownerId);
    }
    return Response.json({ noteId, everywhere: body.everywhere === true, chatIds: targetChatIds });
  }
  const scope = body.scope === "chat" ? "chat" : "global";
  const ids = noteIds(body.noteIds);
  if (scope === "chat" && (!chatId || !getChat(chatId, ownerId))) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }
  const allowed = new Set(listNotes({ ownerId, chatId: scope === "chat" ? chatId : undefined, scope }).map((note) => note.id));
  const validIds = ids.filter((id) => allowed.has(id));
  if (scope === "global") {
    const settings = getGlobalModelSettings(ownerId);
    saveGlobalModelSettings({ ...settings, pinnedNoteIds: validIds }, ownerId);
  } else {
    const chat = getChat(chatId, ownerId);
    const globalIds = getGlobalModelSettings(ownerId).pinnedNoteIds || [];
    const previousExclusions = chat?.sessionState?.unpinnedGlobalNoteIds || [];
    const exclusions = [
      ...previousExclusions.filter((id) => !validIds.includes(id)),
      ...globalIds.filter((id) => !validIds.includes(id) && !ids.includes(id)),
    ];
    updateChat(chatId, {
      sessionState: {
        ...(chat?.sessionState || {}),
        pinnedNoteIds: validIds,
        unpinnedGlobalNoteIds: [...new Set(exclusions)].slice(-20),
      },
      touchUpdatedAt: false,
    }, ownerId);
  }
  return Response.json({ scope, noteIds: validIds });
}
