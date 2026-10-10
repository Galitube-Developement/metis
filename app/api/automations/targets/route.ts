import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { listChatsForUser } from "@/lib/db-store";
import { getProject } from "@/lib/projects";
import { listProjectAgents } from "@/lib/project-team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Account context is required" }, { status: 401 });
  const projectId = new URL(req.url).searchParams.get("projectId")?.trim() || undefined;
  const project = projectId ? getProject(projectId, ownerId) : null;
  if (projectId && !project) return Response.json({ error: "Project not found" }, { status: 404 });
  if (project?.mode === "agents") {
    return Response.json({ chats: [], agents: listProjectAgents(project.id, ownerId)
      .filter((agent) => !agent.archivedAt)
      .map(({ id, chatId, name, role }) => ({ id, chatId, name, role })) });
  }
  return Response.json({ agents: [], chats: listChatsForUser(ownerId)
    .filter((chat) => (chat.projectId || undefined) === projectId)
    .map(({ id, title }) => ({ id, title })) });
}
