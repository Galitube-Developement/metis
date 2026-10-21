import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChatNotePins, getGlobalModelSettings, saveGlobalModelSettings } from "@/lib/db-store";
import { listNotes } from "@/lib/shared-context";
import { applyPinUpdate, effectivePins, listPinChats, pinIds, pinUpdateNeedsWorker, type PinUpdate } from "@/lib/note-pins";
import { updateNotePinsOffThread } from "@/lib/chat-page-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({error:"Unauthorized"},{status:401});
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({error:"Unauthorized"},{status:401});
  const params=new URL(req.url).searchParams;
  const chatId=params.get("chatId")?.trim() || "",noteId=params.get("noteId")?.trim() || "";
  const chatPins=chatId?getChatNotePins(chatId,ownerId):null;
  if(chatId && !chatPins)return Response.json({error:"Chat not found"},{status:404});
  const globalNoteIds=getGlobalModelSettings(ownerId).pinnedNoteIds || [];
  // Chat overlays need one chat, not every available picker choice.
  const chats=noteId || !chatId ? listPinChats(ownerId) : [];
  const configuredChatIds=noteId?chats.filter(chat=>effectivePins(globalNoteIds,chat).includes(noteId)).map(chat=>chat.id):[];
  const configuredNoteIds=[...new Set(chats.flatMap(chat=>chat.pinnedNoteIds))];
  const picker=params.get("picker")==="1";
  const search=(params.get("search") || "").trim().toLocaleLowerCase().slice(0,200);
  const filtered=picker?chats.filter(chat=>chat.title.toLocaleLowerCase().includes(search)):chats;
  const offset=picker?Math.max(0,Math.floor(Number(params.get("offset")) || 0)):0;
  const page=picker?filtered.slice(offset,offset+50):filtered;
  return Response.json({
    globalNoteIds,chatNoteIds:chatPins?.pinnedNoteIds || [],
    pinnedNoteIds:chatPins?effectivePins(globalNoteIds,{pinnedNoteIds:chatPins.pinnedNoteIds || [],unpinnedGlobalNoteIds:chatPins.unpinnedGlobalNoteIds || []}):globalNoteIds,
    ...(noteId?{}:{notes:listNotes({ownerId,chatId:chatId || undefined})}),
    chats:page.map(chat=>({id:chat.id,title:chat.title || "Untitled chat"})),configuredChatIds,configuredNoteIds,
    ...(picker?{totalChats:filtered.length,nextOffset:offset+page.length<filtered.length?offset+page.length:null}:{}),
  },{headers:{"Cache-Control":"no-store"}});
}

export async function PATCH(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({error:"Unauthorized"},{status:401});
  const ownerId=await getAuthenticatedUserId(req);
  if(!ownerId)return Response.json({error:"Unauthorized"},{status:401});
  const body=await req.json().catch(()=>({})) as {chatId?:unknown;scope?:unknown;noteIds?:unknown;noteId?:unknown;everywhere?:unknown;chatIds?:unknown};
  const chatId=typeof body.chatId==="string"?body.chatId.trim():"",noteId=typeof body.noteId==="string"?body.noteId.trim():"";
  let update:PinUpdate;
  if(noteId){
    if(!listNotes({ownerId}).some(note=>note.id===noteId))return Response.json({error:"Note not found"},{status:404});
    const chatIds=pinIds(body.chatIds);
    if(chatIds.length>10000)return Response.json({error:"Too many chat selections"},{status:400});
    update={noteId,everywhere:body.everywhere===true,chatIds};
  }else{
    const scope=body.scope==="chat"?"chat":"global",ids=pinIds(body.noteIds).slice(0,20);
    if(scope==="chat" && (!chatId || !getChatNotePins(chatId,ownerId)))return Response.json({error:"Chat not found"},{status:404});
    const allowed=new Set(listNotes({ownerId,chatId:scope==="chat"?chatId:undefined,scope}).map(note=>note.id));
    const validIds=ids.filter(id=>allowed.has(id));
    if(scope==="global"){
      const settings=getGlobalModelSettings(ownerId);
      if(JSON.stringify(settings.pinnedNoteIds || [])!==JSON.stringify(validIds))saveGlobalModelSettings({...settings,pinnedNoteIds:validIds},ownerId);
      return Response.json({scope,noteIds:validIds});
    }
    update={chatId,noteIds:validIds,requestedIds:ids};
  }
  try{
    const result=pinUpdateNeedsWorker(ownerId,update)?await updateNotePinsOffThread(ownerId,update):applyPinUpdate(ownerId,update);
    return result?Response.json(result):Response.json({error:"Chat not found"},{status:404});
  }catch(error){
    console.error("Could not update note pins",error);
    return Response.json({error:"Could not save pin settings. Please retry."},{status:503});
  }
}
