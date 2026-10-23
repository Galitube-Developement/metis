import { bulkUpdateIssues, createIssue, getIssueSettings, issueMembers, listIssues } from "@/lib/issues";
import { getNote } from "@/lib/shared-context";
import type { IssueWriteInput } from "@/lib/issue-types";
import { issueBody, issueFailure, issueProject, issueResponse, issueUser } from "./_shared";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request) {
  try {
    const userId=await issueUser(req),params=new URL(req.url).searchParams;
    const noteId=params.get("noteId")||undefined;
    const projectId=issueProject(params.has("projectId")?params.get("projectId"):noteId?getNote(noteId,userId)?.projectId:null);
    return issueResponse({issues:listIssues(userId,{projectId,noteId,issuebookId:params.get("issuebookId")||undefined,search:params.get("search")||undefined,status:params.get("status")||undefined,assigneeId:params.get("assigneeId")||undefined}),currentUserId:userId,members:issueMembers(userId,projectId),settings:getIssueSettings(userId,projectId)});
  } catch(error) { return issueFailure(error); }
}
export async function POST(req:Request) {
  try {
    const userId=await issueUser(req),body=await issueBody(req);
    const issue=createIssue(userId,{...body,projectId:issueProject(body.projectId)} as IssueWriteInput,req.headers.get("idempotency-key")||undefined);
    return issueResponse({issue},201);
  } catch(error) { return issueFailure(error); }
}
export async function PATCH(req:Request) {
  try {
    const userId=await issueUser(req),body=await issueBody(req);
    if(!body.patch || typeof body.patch!=="object" || Array.isArray(body.patch)) return issueResponse({error:"Expected an issue patch."},400);
    return issueResponse({issues:bulkUpdateIssues(userId,body.ids as string[],body.patch as IssueWriteInput)});
  } catch(error) { return issueFailure(error); }
}
