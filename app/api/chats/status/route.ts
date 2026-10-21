import { getAuthenticatedUser } from "@/lib/auth";
import { getDatabase } from "@/lib/sqlite";
import { canAccessChat } from "@/lib/project-access";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request){
 const user=await getAuthenticatedUser(req);
 if(!user)return Response.json({error:"Unauthorized"},{status:401});
 const ids=[...new Set((new URL(req.url).searchParams.get("ids") || "").split(",").filter(Boolean))];
 if(ids.length>100 || ids.some(id=>id.length>200))return Response.json({error:"Too many chat IDs"},{status:400});
 const statuses:Record<string,string>=Object.fromEntries(ids.map(id=>[id,"unavailable"]));
 if(ids.length){
  const rows=getDatabase().prepare(`SELECT id,run_status AS status FROM chat_list WHERE id IN (${ids.map(()=>"?").join(",")})`).all(...ids) as {id:string;status?:string}[];
  for(const row of rows)if(canAccessChat(row.id,user.id))statuses[row.id]=row.status || "idle";
 }
 return Response.json({statuses},{headers:{"Cache-Control":"private, no-store"}});
}
