import { getDatabase, transaction } from "@/lib/sqlite";
import { getChatNotePins, getGlobalModelSettings, saveGlobalModelSettings } from "@/lib/db-store";
import { recordChatSyncEvent } from "@/lib/chat-sync";

export type PinState = { pinnedNoteIds: string[]; unpinnedGlobalNoteIds: string[] };
export type PinChat = PinState & { id: string; title: string; ownerId: string; projectId: string | null; updatedAt: string };
export type PinUpdate = { noteId: string; everywhere: boolean; chatIds: string[] } | { chatId: string; noteIds: string[]; requestedIds: string[] };
export function pinIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && !!id.trim()).map(id => id.trim().slice(0,120)))] : [];
}
function parsePins(raw: string | null): PinState {
  let value: Partial<PinState> = {};
  try { value = JSON.parse(raw || "{}") || {}; } catch {}
  return { pinnedNoteIds: pinIds(value.pinnedNoteIds), unpinnedGlobalNoteIds: pinIds(value.unpinnedGlobalNoteIds) };
}
export function effectivePins(global: string[], pins: PinState) {
  const excluded = new Set(pins.unpinnedGlobalNoteIds);
  return [...new Set([...global.filter(id => !excluded.has(id)), ...pins.pinnedNoteIds])].slice(0,20);
}
/** One small projection query, including personal settings and membership checks. */
export function listPinChats(ownerId: string): PinChat[] {
  const rows = getDatabase().prepare(`SELECT c.id,c.title,c.owner_id AS ownerId,c.project_id AS projectId,c.updated_at AS updatedAt,
    CASE WHEN c.project_id IS NOT NULL AND json_type(u.data,'$.sessionState')='object'
      THEN json_extract(u.data,'$.sessionState')
      WHEN c.project_id IS NOT NULL AND c.owner_id!=? THEN '{}'
      ELSE c.note_pins END AS pins
    FROM chat_list c LEFT JOIN chat_user_settings u ON u.chat_id=c.id AND u.user_id=?
    LEFT JOIN projects p ON p.id=c.project_id
    WHERE c.incognito=0 AND c.archived=0 AND COALESCE(c.automation_run_id,'')=''
      AND ((p.id IS NULL AND c.owner_id=?) OR (p.id IS NOT NULL AND
        (p.owner_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?))))
    ORDER BY c.pinned DESC,COALESCE(c.last_message_sent,c.created_at) DESC,c.id`).all(ownerId,ownerId,ownerId,ownerId,ownerId) as Array<Omit<PinChat,keyof PinState> & { pins: string | null }>;
  return rows.map(row => {
    // Legacy workers can insert NULL projections; only those rows need the fallback.
    const pins = row.pins === null ? getChatNotePins(row.id,ownerId) : parsePins(row.pins);
    return { ...row, pinnedNoteIds:pins?.pinnedNoteIds || [], unpinnedGlobalNoteIds:pins?.unpinnedGlobalNoteIds || [] };
  });
}
type Change = { chat: PinChat; pins: PinState };
function plan(ownerId: string, update: PinUpdate) {
  const settings = getGlobalModelSettings(ownerId);
  const global = settings.pinnedNoteIds || [];
  const changes: Change[] = [];
  let nextGlobal = global, result: Record<string,unknown>;
  if ("noteId" in update) {
    const chats = listPinChats(ownerId), selected = new Set(update.chatIds);
    nextGlobal = update.everywhere ? [...new Set([...global,update.noteId])].slice(0,20) : global.filter(id => id !== update.noteId);
    for (const chat of chats) {
      // Everywhere is inherited from the global setting; never duplicate it into every chat.
      const included = !update.everywhere && selected.has(chat.id);
      const pins = {
        pinnedNoteIds: included ? [...new Set([...chat.pinnedNoteIds,update.noteId])].slice(-20) : chat.pinnedNoteIds.filter(id => id !== update.noteId),
        unpinnedGlobalNoteIds: update.everywhere || included ? chat.unpinnedGlobalNoteIds.filter(id => id !== update.noteId) : chat.unpinnedGlobalNoteIds,
      };
      if (JSON.stringify(pins) !== JSON.stringify({pinnedNoteIds:chat.pinnedNoteIds,unpinnedGlobalNoteIds:chat.unpinnedGlobalNoteIds})) changes.push({chat,pins});
    }
    result={noteId:update.noteId,everywhere:update.everywhere,chatIds:update.everywhere?[]:chats.filter(chat=>selected.has(chat.id)).map(chat=>chat.id)};
  } else {
    const current = getChatNotePins(update.chatId,ownerId);
    if (!current) return null;
    const meta=getDatabase().prepare("SELECT id,title,owner_id AS ownerId,project_id AS projectId,updated_at AS updatedAt FROM chat_list WHERE id=?").get(update.chatId) as Omit<PinChat,keyof PinState>;
    const pins={pinnedNoteIds:update.noteIds,unpinnedGlobalNoteIds:[...new Set([
      ...(current.unpinnedGlobalNoteIds || []).filter(id=>!update.noteIds.includes(id)),
      ...global.filter(id=>!update.noteIds.includes(id) && !update.requestedIds.includes(id)),
    ])].slice(-20)};
    if(JSON.stringify(pins)!==JSON.stringify(current)) changes.push({chat:{...meta,pinnedNoteIds:current.pinnedNoteIds || [],unpinnedGlobalNoteIds:current.unpinnedGlobalNoteIds || []},pins});
    result={scope:"chat",noteIds:update.noteIds};
  }
  return {settings,global,nextGlobal,changes,result};
}
export function pinUpdateNeedsWorker(ownerId: string, update: PinUpdate) {
  const planned=plan(ownerId,update);
  if(!planned)return false;
  if(planned.changes.length>8)return true;
  const size=getDatabase().prepare("SELECT length(CAST(data AS BLOB)) AS bytes FROM chats WHERE id=?");
  return planned.changes.some(({chat})=> ((size.get(chat.id) as {bytes:number}|undefined)?.bytes || 0) > 256 * 1024);
}
/** Patch only pin fields. No message hydration, todo scans or transcript serialization. */
export function applyPinUpdate(ownerId: string, update: PinUpdate) {
  return transaction(()=>{
    const planned=plan(ownerId,update);
    if(!planned)return null;
    const db=getDatabase();
    if(JSON.stringify(planned.global)!==JSON.stringify(planned.nextGlobal))
      saveGlobalModelSettings({...planned.settings,pinnedNoteIds:planned.nextGlobal},ownerId);
    for(const {chat,pins} of planned.changes) {
      const ids=JSON.stringify(pins.pinnedNoteIds),excluded=JSON.stringify(pins.unpinnedGlobalNoteIds);
      if(chat.projectId) {
        // An owner without a personal override inherits the canonical draft/goal.
        // Preserve that base when creating the first personal pin override.
        const base = chat.ownerId===ownerId
          ? (db.prepare("SELECT json_extract(data,'$.sessionState') AS session FROM chats WHERE id=?").get(chat.id) as {session:string|null})?.session || "{}"
          : "{}";
        db.prepare(`INSERT INTO chat_user_settings(chat_id,user_id,data) VALUES(?,?,json_object('sessionState',
            json_set(json(?),'$.pinnedNoteIds',json(?),'$.unpinnedGlobalNoteIds',json(?))))
          ON CONFLICT(chat_id,user_id) DO UPDATE SET data=json_set(
            CASE WHEN json_type(data,'$.sessionState')='object' THEN data ELSE json_set(data,'$.sessionState',json(?)) END,
            '$.sessionState.pinnedNoteIds',json(?),'$.sessionState.unpinnedGlobalNoteIds',json(?))`)
          .run(chat.id,ownerId,base,ids,excluded,base,ids,excluded);
      }
      if(chat.ownerId===ownerId) {
        const state=db.prepare("SELECT revision,ready_revision FROM chat_page_state WHERE chat_id=?").get(chat.id) as {revision:number;ready_revision:number}|undefined;
        db.prepare(`UPDATE chats SET data=json_set(
          CASE WHEN json_type(data,'$.sessionState')='object' THEN data ELSE json_set(data,'$.sessionState',json('{}')) END,
          '$.sessionState.pinnedNoteIds',json(?),'$.sessionState.unpinnedGlobalNoteIds',json(?)) WHERE id=?`).run(ids,excluded,chat.id);
        db.prepare("UPDATE chat_list SET note_pins=? WHERE id=?").run(JSON.stringify(pins),chat.id);
        // The trigger increments revision; only an already-current projection can be advanced.
        if(state && state.revision===state.ready_revision) db.prepare(`UPDATE chat_page_state SET metadata=json_set(
          CASE WHEN json_type(metadata,'$.sessionState')='object' THEN metadata ELSE json_set(metadata,'$.sessionState',json('{}')) END,
          '$.sessionState.pinnedNoteIds',json(?),'$.sessionState.unpinnedGlobalNoteIds',json(?)),ready_revision=revision WHERE chat_id=?`).run(ids,excluded,chat.id);
      }
      recordChatSyncEvent({ownerId:chat.ownerId,chatId:chat.id,chatUpdatedAt:chat.updatedAt});
    }
    return {...planned.result,changedChats:planned.changes.length};
  });
}
