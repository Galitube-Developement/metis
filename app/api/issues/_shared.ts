import { getAuthenticatedUserId } from "@/lib/auth";
import { IssueError } from "@/lib/issues";
import { logError } from "@/lib/error-logs";
import { featureFlags } from "@/lib/feature-flags";
import { getGlobalModelSettings } from "@/lib/db-store";
export const issueHeaders={"Cache-Control":"private, no-store"};
export async function issueUser(req:Request) {
  const userId=await getAuthenticatedUserId(req);
  if(!userId) throw new IssueError("Unauthorized",401);
  if(!featureFlags(getGlobalModelSettings(userId)).notes) throw new IssueError("Notes are disabled",404);
  return userId;
}
export function issueResponse(value:unknown,status=200) { return Response.json(value,{status,headers:issueHeaders}); }
export function issueFailure(error:unknown) {
  if(error instanceof IssueError) return issueResponse({error:error.message},error.status);
  const reference=logError({source:"api",level:"error",message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined,context:{route:"issues"}});
  return issueResponse({error:"Issues are temporarily unavailable. Please retry."+(reference?" Reference #"+reference+".":"")},500);
}
export async function issueBody(req:Request):Promise<Record<string,unknown>> {
  const value=await req.json().catch(()=>null);
  if(!value || typeof value!=="object" || Array.isArray(value)) throw new IssueError("Expected a JSON object.");
  return value;
}
export function issueProject(value:unknown):string|null {
  if(value===null || value===undefined || value==="none" || value==="") return null;
  if(typeof value!=="string" || value.length>120) throw new IssueError("Invalid project.");
  return value;
}
