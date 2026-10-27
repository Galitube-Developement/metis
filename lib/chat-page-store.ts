import type { DatabaseSync } from "node:sqlite";
import type { Chat, ChatMessage, ToolPart } from "@/lib/store";
import { compactChatPageMessages } from "@/lib/chat-page-payload";
import { currentChatTodos } from "@/lib/chat-todos";
import { syncChatSearch } from "@/lib/chat-search-store";
import { applyChatCheckpoints } from "@/lib/chat-checkpoints";

export const CHAT_EVENT_PAGE_SIZE = 24;
export const CHAT_PAGE_BYTE_BUDGET = 256 * 1024;
const TEXT_PREVIEW = 16_384;
export const CHAT_PAGE_SCHEMA = `
 CREATE TABLE IF NOT EXISTS chat_page_state (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1, ready_revision INTEGER NOT NULL DEFAULT 0,
  metadata TEXT, total INTEGER NOT NULL DEFAULT 0
 );
 CREATE TABLE IF NOT EXISTS chat_message_checkpoints (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL, position INTEGER NOT NULL,
  data TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(chat_id,message_id)
 );
 CREATE TABLE IF NOT EXISTS chat_page_messages (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, message_id TEXT NOT NULL, data TEXT NOT NULL,
  preview TEXT NOT NULL, todo TEXT,
  PRIMARY KEY(chat_id,position), UNIQUE(chat_id,message_id)
 );
 CREATE INDEX IF NOT EXISTS chat_page_todos ON chat_page_messages(chat_id,position DESC) WHERE todo IS NOT NULL;
 CREATE TABLE IF NOT EXISTS chat_page_tools (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL, tool_id TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(chat_id,message_id,tool_id)
 );
 CREATE TABLE IF NOT EXISTS chat_page_events (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(chat_id,message_id,position)
 );
 CREATE TRIGGER IF NOT EXISTS chat_page_insert AFTER INSERT ON chats BEGIN
  INSERT INTO chat_page_state(chat_id) VALUES(new.id)
  ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1;
 END;
 CREATE TRIGGER IF NOT EXISTS chat_page_update AFTER UPDATE OF data ON chats BEGIN
  INSERT INTO chat_page_state(chat_id) VALUES(new.id)
  ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1;
 END;
`;

export type PageState = { revision: number; ready_revision: number; metadata: string | null; total: number };
export function pageState(db: DatabaseSync, id: string): PageState | undefined {
 return db.prepare("SELECT revision,ready_revision,metadata,total FROM chat_page_state WHERE chat_id=?").get(id) as PageState | undefined;
}
export function pageIsReady(db: DatabaseSync, id: string) {
 const state=pageState(db,id);
 return !!state && state.revision===state.ready_revision && !!state.metadata;
}
function urls(chatId: string,messageId: string) {
 return `/api/chats/${encodeURIComponent(chatId)}/message?messageId=${encodeURIComponent(messageId)}`;
}
function messageRows(db: DatabaseSync, chatId: string, message: ChatMessage, position: number) {
 const [base]=compactChatPageMessages([message],chatId);
 const revision=pageState(db,chatId)?.revision ?? 0;
 const versioned=<T extends ToolPart>(tool:T):T=>({...tool,...(tool.resultUrl?{resultUrl:tool.resultUrl+"&revision="+revision}:{}),...(tool.inputUrl?{inputUrl:tool.inputUrl+"&revision="+revision}:{})});
 const compact={...base,tools:base.tools?.map(versioned),parts:base.parts?.map(part=>part.type==="tool"?versioned(part):part)};
 const detailUrl=urls(chatId,message.id);
 const parts=compact.parts || (compact.tools || []).map(tool=>({type:"tool" as const,...tool}));
 const events=parts.map(part=>part.type==="text" || part.type==="thinking"
  ? {...part,content:part.content.slice(0,TEXT_PREVIEW),...(part.content.length>TEXT_PREVIEW?{contentUrl:detailUrl+"&full=1"}:{})} : part);
 const offset=Math.max(0,events.length-CHAT_EVENT_PAGE_SIZE);
 let selected=events.slice(offset);
 const ids=new Set(selected.flatMap(part=>part.type==="tool"?[part.id]:[]));
 const preview={...compact,
  content:compact.content.slice(0,TEXT_PREVIEW),
  thinking:compact.thinking?.slice(0,4096),
  referenceText:compact.referenceText?.slice(0,2048),
  errorMessage:compact.errorMessage?.slice(0,2048),
  references:compact.references?.slice(0,20).map(reference=>({...reference,content:reference.content?.slice(0,512),detail:reference.detail?.slice(0,512)})),
  ...(compact.content.length>TEXT_PREVIEW || (compact.thinking?.length || 0)>4096 ? {contentUrl:detailUrl+"&full=1"}:{}),
  ...(compact.tools ? {tools:compact.tools.filter(tool=>ids.has(tool.id))}:{}),
  ...(compact.parts ? {parts:selected}:{}),
  ...(offset ? {eventsUrl:detailUrl+"&before="+offset,eventOffset:offset}:{}),
 };
 // A single long run can have thousands of events in one assistant message.
 // Trim the initial event window further to a byte budget, retaining a cursor.
 while(Buffer.byteLength(JSON.stringify(preview))>64*1024 && selected.length>1){
  selected=selected.slice(1);
  const nextOffset=events.length-selected.length;
  const kept=new Set(selected.flatMap(part=>part.type==="tool"?[part.id]:[]));
  if(compact.parts)preview.parts=selected;
  if(compact.tools)preview.tools=compact.tools.filter(tool=>kept.has(tool.id));
  Object.assign(preview,{eventOffset:nextOffset,eventsUrl:detailUrl+"&before="+nextOffset});
 }
 const todo=currentChatTodos([message]);
 db.prepare("INSERT INTO chat_page_messages VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id,position) DO UPDATE SET message_id=excluded.message_id,data=excluded.data,preview=excluded.preview,todo=excluded.todo")
  .run(chatId,position,message.id,JSON.stringify(message),JSON.stringify(preview),todo?JSON.stringify(todo):null);
 db.prepare("DELETE FROM chat_page_tools WHERE chat_id=? AND message_id=?").run(chatId,message.id);
 const toolInsert=db.prepare("INSERT OR REPLACE INTO chat_page_tools VALUES(?,?,?,?)");
 // Parts override legacy duplicate tools, as currentChatTodos does.
 const tools=new Map<string,ToolPart>((message.tools || []).map(t=>[t.id,t]));
 for(const part of message.parts || [])if(part.type==="tool")tools.set(part.id,{...tools.get(part.id),...part});
 for(const tool of tools.values())toolInsert.run(chatId,message.id,tool.id,JSON.stringify(tool));
 db.prepare("DELETE FROM chat_page_events WHERE chat_id=? AND message_id=?").run(chatId,message.id);
 const eventInsert=db.prepare("INSERT INTO chat_page_events VALUES(?,?,?,?)");
 for(let i=0;i<events.length;i++)eventInsert.run(chatId,message.id,i,JSON.stringify(events[i]));
}

/** Update one streaming message without rewriting the canonical history blob.
 * The caller holds the writer transaction and has verified both indexes current. */
export function syncChatCheckpointPage(db: DatabaseSync, chat: Chat, message: ChatMessage, position: number) {
 const state=pageState(db,chat.id)!;
 const search=db.prepare("SELECT ready_revision FROM chat_search_state WHERE chat_id=?").get(chat.id) as {ready_revision:number}|undefined;
 if(state.ready_revision!==state.revision || search?.ready_revision!==state.revision) throw new Error("Streaming indexes changed before checkpoint");
 db.prepare("UPDATE chat_page_state SET revision=revision+1 WHERE chat_id=?").run(chat.id);
 messageRows(db,chat.id,message,position);
 syncChatSearch(db,chat,state.revision+1,{message,position});
 const {messages: _messages,...metadata}=chat;
 db.prepare("UPDATE chat_page_state SET metadata=?,ready_revision=revision WHERE chat_id=?").run(JSON.stringify(metadata),chat.id);
}

/** Append after a canonical json_insert, without hydrating historical messages.
 * Caller verified page/search readiness before its write advanced the revision. */
export function syncChatAppendedPage(db: DatabaseSync, chat: Chat, message: ChatMessage, position: number) {
 const state=pageState(db,chat.id)!;
 if(state.ready_revision!==state.revision-1) throw new Error("Append index changed before submission");
 messageRows(db,chat.id,message,position);
 syncChatSearch(db,chat,state.revision,{message,position});
 const {messages:_messages,...metadata}=chat;
 db.prepare("UPDATE chat_page_state SET metadata=?,total=?,ready_revision=revision WHERE chat_id=?")
  .run(JSON.stringify(metadata),position+1,chat.id);
}

/** Called in the canonical write transaction. Full saves consolidate streaming deltas. */
export function syncChatPage(db: DatabaseSync, chat: Chat, change?: { message?: ChatMessage; position?: number; metadataOnly?: boolean }) {
 const state=pageState(db,chat.id);
 syncChatSearch(db,chat,state?.revision ?? 1,change);
 const incremental=!!change && !!state?.metadata && state.ready_revision===state.revision-1;
 if(!incremental) {
  db.prepare("DELETE FROM chat_page_messages WHERE chat_id=?").run(chat.id);
  db.prepare("DELETE FROM chat_page_tools WHERE chat_id=?").run(chat.id);
  db.prepare("DELETE FROM chat_page_events WHERE chat_id=?").run(chat.id);
  chat.messages.forEach((message,index)=>messageRows(db,chat.id,message,index));
 } else if(change?.message && change.position!==undefined) {
  messageRows(db,chat.id,change.message,change.position);
 }
 const {messages: _messages,...metadata}=chat;
 db.prepare("UPDATE chat_page_state SET metadata=?,total=?,ready_revision=revision WHERE chat_id=?")
  .run(JSON.stringify(metadata),chat.messages.length,chat.id);
}

/** Legacy/import/rollback recovery. Run off the web event loop. Commits only the revision it read. */
export function rebuildChatPage(db: DatabaseSync,id: string) {
 db.prepare("INSERT OR IGNORE INTO chat_page_state(chat_id) SELECT id FROM chats WHERE id=?").run(id);
 const state=pageState(db,id);
 if(!state || pageIsReady(db,id))return;
 const row=db.prepare("SELECT data,updated_at FROM chats WHERE id=?").get(id) as {data:string;updated_at:string}|undefined;
 if(!row)return;
 const chat=applyChatCheckpoints(db,JSON.parse(row.data) as Chat);
 if(row.updated_at>chat.updatedAt)chat.updatedAt=row.updated_at;
 // No writer lock while parsing. A concurrent checkpoint wins; callers retry.
 db.exec("BEGIN IMMEDIATE");
 try {
  if(pageState(db,id)?.revision!==state.revision){db.exec("ROLLBACK");return;}
  syncChatPage(db,chat);
  db.exec("COMMIT");
 } catch(error){db.exec("ROLLBACK");throw error;}
}

export function readChatPage(db: DatabaseSync,id: string,limit: number,offset: number,before?: number) {
 const state=pageState(db,id);
 if(!state || state.revision!==state.ready_revision || !state.metadata)return null;
 const total=state.total;
 const end=before===undefined?Math.max(0,total-offset):Math.min(total,Math.max(0,before));
 const rows=db.prepare("SELECT position,preview FROM chat_page_messages WHERE chat_id=? AND position<? ORDER BY position DESC LIMIT ?")
  .all(id,end,Math.min(100,Math.max(1,limit))) as {position:number;preview:string}[];
 const chosen:typeof rows=[];
 let bytes=0;
 for(const row of rows) {
  if(chosen.length && bytes+Buffer.byteLength(row.preview)>CHAT_PAGE_BYTE_BUDGET)break;
  chosen.push(row);bytes+=Buffer.byteLength(row.preview);
 }
 const start=chosen.at(-1)?.position ?? end;
 const currentTodos=readChatTodos(db,id);
 const chat={...JSON.parse(state.metadata),messages:chosen.reverse().map(row=>({...JSON.parse(row.preview),historyPosition:row.position}))} as Chat;
 return {chat,currentTodos,messageOffset:total-end,hasEarlierMessages:start>0,totalMessages:total,
  nextMessageBefore:start,pageRevision:state.revision};
}
export function readChatTodos(db:DatabaseSync,id:string) {
 const row=db.prepare("SELECT todo FROM chat_page_messages WHERE chat_id=? AND todo IS NOT NULL ORDER BY position DESC LIMIT 1").get(id) as {todo:string}|undefined;
 return row?JSON.parse(row.todo):null;
}
export function readMessageEvents(db:DatabaseSync,id:string,messageId:string,before:number) {
 if(!pageIsReady(db,id))return null;
 const message=db.prepare("SELECT preview FROM chat_page_messages WHERE chat_id=? AND message_id=?").get(id,messageId) as {preview:string}|undefined;
 if(!message)return null;
 const rows=db.prepare("SELECT position,data FROM chat_page_events WHERE chat_id=? AND message_id=? AND position<? ORDER BY position DESC LIMIT ?")
  .all(id,messageId,before,CHAT_EVENT_PAGE_SIZE) as {position:number;data:string}[];
 const start=rows.at(-1)?.position || 0;
 const parts=rows.reverse().map(row=>JSON.parse(row.data));
 return {...JSON.parse(message.preview),parts,tools:parts.filter(p=>p.type==="tool"),
  eventOffset:start,eventsUrl:start?urls(id,messageId)+"&before="+start:undefined};
}
