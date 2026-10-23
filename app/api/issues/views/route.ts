import { getIssueSettings, saveIssueSettings } from "@/lib/issues";
import { issueBody, issueFailure, issueProject, issueResponse, issueUser } from "../_shared";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request) {
  try {const userId=await issueUser(req),projectId=issueProject(new URL(req.url).searchParams.get("projectId"));return issueResponse({settings:getIssueSettings(userId,projectId)});}
  catch(error){return issueFailure(error);}
}
export async function PUT(req:Request) {
  try {const userId=await issueUser(req),body=await issueBody(req);return issueResponse({settings:saveIssueSettings(userId,issueProject(body.projectId),body.settings)});}
  catch(error){return issueFailure(error);}
}
