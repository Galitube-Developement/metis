import { getAuthenticatedUserId } from "@/lib/auth";
import { notificationInbox, markNotificationsRead } from "@/lib/project-sharing";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(req:Request) {
 const userId=await getAuthenticatedUserId(req);
 return userId ? reply(notificationInbox(userId)) : reply({error:"Unauthorized"},401);
}
export async function POST(req:Request) {
 const userId=await getAuthenticatedUserId(req);
 if(!userId)return reply({error:"Unauthorized"},401);
 const body=await req.json().catch(()=>null);
 if(body?.all===true) return reply(markNotificationsRead(userId,null));
 if(!Array.isArray(body?.ids)||body.ids.length>100||!body.ids.every((id:unknown)=>typeof id==="string" && id.length<=200))return reply({error:"Invalid notification IDs."},400);
 return reply(markNotificationsRead(userId,body.ids));
}
