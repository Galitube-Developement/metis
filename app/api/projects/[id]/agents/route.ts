import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { captureApiError } from "@/lib/error-logs";
import { getProject } from "@/lib/projects";
import { createProjectAgent, createProjectTeamPreset, listProjectAgents, syncProjectHandoffStatuses } from "@/lib/project-team";

import { importTeamDraft } from "@/lib/team-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ agents: listProjectAgents(id, ownerId), handoffs: syncProjectHandoffStatuses(id, ownerId) });
}

export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.draft) return Response.json({ agents: importTeamDraft(id, body.draft, ownerId) }, { status: 201 });
    if (body.preset === true) return Response.json({ agents: createProjectTeamPreset(id, ownerId) }, { status: 201 });
    const agent = createProjectAgent({
      projectId: id, ownerId,
      name: typeof body.name === "string" ? body.name : undefined,
      role: typeof body.role === "string" ? body.role : undefined,
      systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
      color: typeof body.color === "string" ? body.color : undefined,
      modelId: typeof body.modelId === "string" ? body.modelId : undefined,
      supervisorId: typeof body.supervisorId === "string" ? body.supervisorId : undefined,
    });
    return Response.json(body.preset === true ? { agents: listProjectAgents(id, ownerId), agent } : { agent }, { status: 201 });
  } catch (error) {
    captureApiError("/api/projects/[id]/agents POST", error, req);
    const message = error instanceof Error ? error.message : "Could not create agent";
    return Response.json({ error: message }, { status: message === "Project not found" ? 404 : 400 });
  }
}
