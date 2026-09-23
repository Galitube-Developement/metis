import { createMemory, deleteMemory, getChat, listMemories, updateMemory } from "@/lib/db-store";
import {
  createProjectMemory,
  deleteProjectMemory,
  listProjectMemories,
  updateProjectMemory,
} from "@/lib/projects";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";
import { bearerTokenMatches } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  return bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  if (jobId && !internalRunLeaseAuthorized(req, jobId)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  if (req.headers.get("x-ai-chat-incognito") === "1") {
    return Response.json({ error: "Memory tools are unavailable in Incognito." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "list";
  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const projectId = chatId ? getChat(chatId, userId)?.projectId : undefined;

  if (action === "list") {
    return Response.json({
      scope: projectId ? "project" : "global",
      memories: projectId ? listProjectMemories(projectId, userId) : listMemories(userId),
    });
  }
  if (action === "add") {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return Response.json({ error: "content is required" }, { status: 400 });
    const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : undefined;
    const memory = projectId
      ? createProjectMemory(projectId, content, tags, userId)
      : createMemory(content, tags, userId);
    return Response.json({ scope: projectId ? "project" : "global", memory });
  }
  if (action === "edit") {
    const id = typeof body.id === "string" ? body.id : "";
    const content = typeof body.content === "string" ? body.content.trim() : undefined;
    const patch = {
      ...(content ? { content } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags.filter((tag): tag is string => typeof tag === "string") } : {}),
    };
    const memory = projectId
      ? updateProjectMemory(projectId, id, patch, userId)
      : updateMemory(id, patch, userId);
    if (!memory) return Response.json({ error: "Memory not found" }, { status: 404 });
    return Response.json({ memory });
  }
  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    const deleted = projectId ? deleteProjectMemory(projectId, id, userId) : deleteMemory(id, userId);
    if (!deleted) return Response.json({ error: "Memory not found" }, { status: 404 });
    return Response.json({ ok: true, id });
  }
  return Response.json({ error: "Unknown memory action" }, { status: 400 });
}
