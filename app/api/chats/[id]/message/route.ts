import { getAuthenticatedUser } from "@/lib/auth";
import { canAccessChat } from "@/lib/project-access";
import { ensureChatPage } from "@/lib/chat-page-loader";
import { getDatabase } from "@/lib/sqlite";
import { readMessageEvents } from "@/lib/chat-page-store";
import { compactChatPageMessages } from "@/lib/chat-page-payload";
import type { ChatMessage } from "@/lib/store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}) {
 const user=await getAuthenticatedUser(req);
 if(!user)return Response.json({error:"Unauthorized"},{status:401});
 const {id}=await params;
 if(!canAccessChat(id,user.id))return Response.json({error:"Not found"},{status:404});
 const query=new URL(req.url).searchParams,messageId=query.get("messageId") || "";
 if(!messageId)return Response.json({error:"messageId is required"},{status:400});
 await ensureChatPage(id);
 const db=getDatabase();
 if(query.get("full")==="1"){
  const row=db.prepare("SELECT data FROM chat_page_messages WHERE chat_id=? AND message_id=?").get(id,messageId) as {data:string}|undefined;
  if(!row)return Response.json({error:"Not found"},{status:404});
  // Full text still needs its ordered tool boundaries. Defer large tool
  // payloads just as the initial page does, while retaining the whole timeline.
  const [{content,thinking,parts,tools}]=compactChatPageMessages([JSON.parse(row.data) as ChatMessage],id);
  return Response.json({content,thinking,parts,tools},{headers:{"Cache-Control":"private, no-store"}});
 }
 const before=Number(query.get("before"));
 if(!Number.isSafeInteger(before)||before<0)return Response.json({error:"Invalid cursor"},{status:400});
 const message=readMessageEvents(db,id,messageId,before);
 return message?Response.json({message},{headers:{"Cache-Control":"private, no-store"}}):Response.json({error:"Not found"},{status:404});
}
