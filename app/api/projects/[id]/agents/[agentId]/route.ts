import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { archiveProjectAgent, listProjectAgents, updateProjectAgent } from "@/lib/project-team";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string; agentId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id, agentId } = await params;
  if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
  const agent = listProjectAgents(id, ownerId).find((item) => item.id === agentId);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (Object.keys(body).some((key) => ["projectId", "chatId", "id", "status", "archivedAt", "createdAt", "updatedAt"].includes(key))) {
    return Response.json({ error: "Immutable agent fields cannot be changed" }, { status: 400 });
  }
  try {
    const updated = updateProjectAgent(id, agentId, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.role === "string" ? { role: body.role } : {}),
      ...(typeof body.systemPrompt === "string" ? { systemPrompt: body.systemPrompt } : {}),
      ...(typeof body.color === "string" ? { color: body.color } : {}),
      ...(typeof body.modelId === "string" || body.modelId === null ? { modelId: body.modelId as string | null } : {}),
      ...(typeof body.supervisorId === "string" || body.supervisorId === null ? { supervisorId: body.supervisorId as string | null } : {}),
    }, ownerId);
    return updated ? Response.json({ agent: updated }) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update agent" }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id, agentId } = await params;
  const agent = archiveProjectAgent(id, agentId, ownerId);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ agent });
}
