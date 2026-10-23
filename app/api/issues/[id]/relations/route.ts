import { addIssueRelation, removeIssueRelation } from "@/lib/issues";
import { issueBody, issueFailure, issueResponse, issueUser } from "../../_shared";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function POST(req:Request,context:Context) {
  try {const userId=await issueUser(req),{id}=await context.params,body=await issueBody(req);return issueResponse({relation:addIssueRelation(id,userId,typeof body.targetId==="string"?body.targetId:"",body.kind as "related"|"blocks")},201);}
  catch(error){return issueFailure(error);}
}
export async function DELETE(req:Request,context:Context) {
  try {const userId=await issueUser(req),{id}=await context.params,body=await issueBody(req);return issueResponse(removeIssueRelation(id,userId,typeof body.relationId==="string"?body.relationId:""));}
  catch(error){return issueFailure(error);}
}
