import { getAuthenticatedUser } from "@/lib/auth";
import { getAccountProfile, saveAccountProfile, ProfileHandleConflict } from "@/lib/account-profile";
import { ZodError } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(req: Request) {
  const user=await getAuthenticatedUser(req);
  if(!user) return Response.json({error:"Unauthorized"},{status:401,headers});
  return Response.json({profile:getAccountProfile(user.id,user.username)}, {headers});
}
export async function PUT(req: Request) {
  const user=await getAuthenticatedUser(req);
  if(!user) return Response.json({error:"Unauthorized"},{status:401,headers});
  if(Number(req.headers.get("content-length"))>400_000) return Response.json({error:"Profile is too large"},{status:413,headers});
  try {
    const reader=req.body?.getReader();
    if(!reader) return Response.json({error:"Missing profile"},{status:400,headers});
    const chunks: Uint8Array[]=[];let size=0;
    try {
      while(true) {
        const {value,done}=await reader.read();if(done)break;
        size+=value.byteLength;
        if(size>400_000) {await reader.cancel();return Response.json({error:"Profile is too large"},{status:413,headers});}
        chunks.push(value);
      }
    } finally {reader.releaseLock();}
    const body=Buffer.concat(chunks).toString("utf8");
    return Response.json({profile:saveAccountProfile(user.id,JSON.parse(body))},{headers});
  } catch (error) {
    if (error instanceof ProfileHandleConflict) return Response.json({error:error.message,field:"handle"},{status:409,headers});
    if (error instanceof ZodError) {
      const handleIssue=error.issues.find(issue=>issue.path[0]==="handle");
      if(handleIssue) return Response.json({error:handleIssue.message,field:"handle"},{status:400,headers});
    }
    return Response.json({error:"Check your name, image and links. Use up to 5 http or https links."},{status:400,headers});
  }
}
