import { getChat, getGlobalModelSettings } from "@/lib/db-store";
import { getJob } from "@/lib/db-jobs";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";
import { bearerTokenMatches } from "@/lib/security";
import { featureFlags } from "@/lib/feature-flags";
import { addIssueComment, addIssueRelation, createIssue, deleteIssue, getIssueDetail, issueMembers, IssueError, listIssues, updateIssue } from "@/lib/issues";
import type { IssueWriteInput } from "@/lib/issue-types";
import { issueBody, issueFailure, issueProject, issueResponse } from "@/app/api/issues/_shared";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Same bearer, live run lease and actor/chat boundary as the existing internal memory/notes tools. */
export async function POST(req:Request) {
  if(!bearerTokenMatches(req,process.env.MCP_BEARER_TOKEN)) return issueResponse({error:"Unauthorized"},401);
  const userId=req.headers.get("x-ai-chat-user-id")?.trim()||"";
  const chatId=req.headers.get("x-ai-chat-id")?.trim()||"";
  const jobId=req.headers.get("x-ai-chat-job-id")?.trim()||"";
  if(!userId||!chatId||!jobId||!internalRunLeaseAuthorized(req,jobId)) return issueResponse({error:"Unauthorized"},401);
  const chat=getChat(chatId,userId);
  if(!chat) return issueResponse({error:"Chat not found"},404);
  const job=getJob(jobId);
  if(!job||job.chatId!==chatId||job.userId!==userId) return issueResponse({error:"Run context does not match this chat"},403);
  if(chat.incognito||req.headers.get("x-ai-chat-incognito")==="1") return issueResponse({error:"Issues are unavailable in Incognito."},403);
  if(!featureFlags(getGlobalModelSettings(userId)).notes) return issueResponse({error:"Notes are disabled"},404);
  try {
    const body=await issueBody(req);
    if(!Object.prototype.hasOwnProperty.call(body,"projectId")) throw new IssueError("Choose an existing projectId, or 'none', explicitly.");
    const projectId=issueProject(body.projectId);
    const action=body.action;
    if(action==="list") return issueResponse({issues:listIssues(userId,{projectId,search:typeof body.search==="string"?body.search:undefined,status:typeof body.status==="string"?body.status:undefined,assigneeId:typeof body.assigneeId==="string"?body.assigneeId:undefined,noteId:typeof body.noteId==="string"?body.noteId:undefined}),members:issueMembers(userId,projectId),currentUserId:userId});
    if(action==="create") return issueResponse({issue:createIssue(userId,{...body,projectId} as IssueWriteInput,typeof body.idempotencyKey==="string"?body.idempotencyKey:undefined)},201);
    const id=typeof body.id==="string"?body.id:"";
    const detail=getIssueDetail(id,userId);
    if(detail.issue.projectId!==projectId) throw new IssueError("Issue not found in this project.",404);
    if(action==="get") return issueResponse(detail);
    if(action==="update") return issueResponse({issue:updateIssue(id,userId,{...body,projectId} as IssueWriteInput)});
    if(action==="delete") return issueResponse(deleteIssue(id,userId));
    if(action==="comment") return issueResponse({comment:addIssueComment(id,userId,body.body)},201);
    if(action==="link") return issueResponse({relation:addIssueRelation(id,userId,typeof body.targetId==="string"?body.targetId:"",body.kind as "related"|"blocks")},201);
    throw new IssueError("Unknown issue action.");
  } catch(error) { return issueFailure(error); }
}
