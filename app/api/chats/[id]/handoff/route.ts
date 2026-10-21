import { getAuthenticatedUser } from "@/lib/auth";
import { canAccessChat } from "@/lib/project-access";
import { withChatProgramEvents } from "@/lib/chat-program-events-server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getAuthenticatedUser(req);
 if(!user)return Response.json({error:"Unauthorized"},{status:401});
 const {id}=await params, handoffId=new URL(req.url).searchParams.get("handoffId") || "";
 if(!canAccessChat(id,user.id))return Response.json({error:"Not found"},{status:404});
 if(!/^[\da-f-]{36}$/i.test(handoffId))return Response.json({error:"Invalid handoff"},{status:400});
 const [message]=withChatProgramEvents([{id:"handoff:"+handoffId+":sent",role:"assistant",content:"",createdAt:""}],id,user.id,true);
 return message?.programEvent?.type==="handoff"?Response.json(message.programEvent.activity,{headers:{"Cache-Control":"private, no-store"}}):Response.json({error:"Not found"},{status:404});
}
