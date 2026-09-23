import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { createProjectMemory, getProject, listProjectMemories } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ memories: listProjectMemories(id, ownerId) });
}

export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { content?: string; tags?: string[] };
  const content = body.content?.trim() || "";
  if (!content) return Response.json({ error: "content is required" }, { status: 400 });
  const memory = createProjectMemory(id, content, body.tags, ownerId);
  if (!memory) return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json({ memory }, { status: 201 });
}
