import { deleteIssue, getIssueDetail, updateIssue } from "@/lib/issues";
import type { IssueWriteInput } from "@/lib/issue-types";
import { issueBody, issueFailure, issueResponse, issueUser } from "../_shared";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(req:Request,context:Context) {
  try { const userId=await issueUser(req),{id}=await context.params;return issueResponse(getIssueDetail(id,userId)); }
  catch(error) { return issueFailure(error); }
}
export async function PATCH(req:Request,context:Context) {
  try { const userId=await issueUser(req),{id}=await context.params;return issueResponse({issue:updateIssue(id,userId,await issueBody(req) as IssueWriteInput)}); }
  catch(error) { return issueFailure(error); }
}
export async function DELETE(req:Request,context:Context) {
  try { const userId=await issueUser(req),{id}=await context.params;return issueResponse(deleteIssue(id,userId)); }
  catch(error) { return issueFailure(error); }
}
