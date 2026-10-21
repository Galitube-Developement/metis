import { getDatabase, transaction } from "@/lib/sqlite";
import { updateChat } from "@/lib/db-store";
import { rebuildChatPage, pageState } from "@/lib/chat-page-store";
import { acknowledgeChatActivity } from "@/lib/chat-activity-server";
import { canAccessChat, chatForUser } from "@/lib/project-access";
import { recordChatSyncEvent } from "@/lib/chat-sync";
import type { Chat } from "@/lib/store";
import { applyPinUpdate } from "@/lib/note-pins";

type Task={chatId:string;operation?:string;ownerId?:string;patch?:Parameters<typeof updateChat>[1];update?:import("./note-pins").PinUpdate};
function acknowledge(task:Task) {
 const db=getDatabase();
 if(!canAccessChat(task.chatId,task.ownerId))return null;
 rebuildChatPage(db,task.chatId);
 return transaction(()=>{
  const state=pageState(db,task.chatId);
  if(!state?.metadata)return null;
  const metadata=JSON.parse(state.metadata) as Chat;
  if(metadata.incognito && metadata.expiresAt && Date.parse(metadata.expiresAt)<=Date.now())return null;
  const activity=acknowledgeChatActivity(task.chatId,task.patch!.readRevision!);
  if(task.patch!.badge===null && task.patch!.readRevision!>=activity.activityRevision){
   // Only badge metadata changes. SQLite patches the canonical JSON off-thread;
   // no full transcript is copied into JS or scanned for todos/activity.
   if(metadata.badge){
    db.prepare("UPDATE chats SET data=json_remove(data,'$.badge') WHERE id=?").run(task.chatId);
    db.prepare("UPDATE chat_page_state SET metadata=json_remove(metadata,'$.badge'),ready_revision=revision WHERE chat_id=?").run(task.chatId);
    delete metadata.badge;
   }
   db.prepare("UPDATE chat_list SET badge=NULL WHERE id=?").run(task.chatId);
  }
  recordChatSyncEvent({ownerId:metadata.ownerId,chatId:task.chatId,chatUpdatedAt:metadata.updatedAt});
  return chatForUser({...metadata,...activity,messages:[]},task.ownerId);
 });
}
export async function run(task:Task) {
 if(task.operation==="notePins" && task.ownerId && task.update){
  return applyPinUpdate(task.ownerId,task.update);
 }
 if(task.operation==="patch" && task.patch){
  const keys=Object.keys(task.patch).filter(key=>task.patch![key as keyof typeof task.patch]!==undefined);
  if(task.patch.readRevision!==undefined && (task.patch.badge===null || task.patch.badge===undefined) && keys.every(key=>["readRevision","badge","touchUpdatedAt"].includes(key)))return acknowledge(task);
  const chat=updateChat(task.chatId,task.patch,task.ownerId);
  return chat?{...chat,messages:[]}:null;
 }
 rebuildChatPage(getDatabase(),task.chatId);
}
