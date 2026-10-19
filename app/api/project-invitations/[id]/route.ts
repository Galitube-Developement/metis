import { getAuthenticatedUserId } from "@/lib/auth";
import { ProjectSharingError, respondProjectInvitation } from "@/lib/project-sharing";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}) {
 const userId=await getAuthenticatedUserId(req);
 if(!userId)return Response.json({error:"Unauthorized"},{status:401});
 try {
  const {action}=await req.json();
  if(action!=="accept" && action!=="decline") return Response.json({error:"Choose accept or decline."},{status:400});
  return Response.json(respondProjectInvitation((await params).id,userId,action),{headers:{"Cache-Control":"private, no-store"}});
 } catch(error) {return Response.json({error:error instanceof ProjectSharingError ? error.message : "Could not respond to invitation."},{status:error instanceof ProjectSharingError ? error.status : 400});}
}
