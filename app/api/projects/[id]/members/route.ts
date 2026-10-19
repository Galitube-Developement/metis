import { getAuthenticatedUserId } from "@/lib/auth";
import { ProjectSharingError, projectMembers, inviteProjectMember, removeProjectMember } from "@/lib/project-sharing";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Params={params:Promise<{id:string}>};
async function handle(req:Request,context:Params,action:"list"|"invite"|"remove") {
  const userId=await getAuthenticatedUserId(req);
  if(!userId) return Response.json({error:"Unauthorized"},{status:401});
  const {id}=await context.params;
  try {
    const body=action==="list" ? {} : await req.json();
    const result=action==="list" ? projectMembers(id,userId) : action==="invite" ? inviteProjectMember(id,userId,typeof body.username==="string" ? body.username : "")
      : removeProjectMember(id,userId,{userId:typeof body.userId==="string" ? body.userId : !body.invitationId ? userId : undefined,invitationId:typeof body.invitationId==="string" ? body.invitationId : undefined});
    return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { return Response.json({error:error instanceof ProjectSharingError ? error.message : "Could not update project members."},{status:error instanceof ProjectSharingError ? error.status : 400}); }
}
export const GET=(req:Request,context:Params)=>handle(req,context,"list");
export const POST=(req:Request,context:Params)=>handle(req,context,"invite");
export const DELETE=(req:Request,context:Params)=>handle(req,context,"remove");
