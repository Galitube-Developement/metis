import { getAuthenticatedUserId } from "@/lib/auth";
import { getUserAgentCwd } from "@/lib/mcp";
import { requireUserExecutionIdentity } from "@/lib/user-access";
import { workspaceFileDownload } from "@/lib/workspace-file-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireUserExecutionIdentity(ownerId);
  } catch {
    return Response.json({ error: "Workspace access is required" }, { status: 403 });
  }
  return workspaceFileDownload(getUserAgentCwd(ownerId), new URL(req.url).searchParams.get("path") || "", req);
}
