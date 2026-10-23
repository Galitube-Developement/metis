import { addIssueComment, getIssueDetail } from "@/lib/issues";
import { issueBody, issueFailure, issueResponse, issueUser } from "../../_shared";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(req:Request,context:Context) {
  try {const userId=await issueUser(req),{id}=await context.params;return issueResponse({comments:getIssueDetail(id,userId).comments});}
  catch(error){return issueFailure(error);}
}
export async function POST(req:Request,context:Context) {
  try {const userId=await issueUser(req),{id}=await context.params,body=await issueBody(req);return issueResponse({comment:addIssueComment(id,userId,body.body)},201);}
  catch(error){return issueFailure(error);}
}
