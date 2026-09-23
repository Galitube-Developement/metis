import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { deleteProjectMemory, updateProjectMemory } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; memoryId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id, memoryId } = await params;
  const body = (await req.json().catch(() => ({}))) as { content?: string; tags?: string[] };
  const memory = updateProjectMemory(id, memoryId, body, ownerId);
  if (!memory) return Response.json({ error: "Memory not found" }, { status: 404 });
  return Response.json({ memory });
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id, memoryId } = await params;
  if (!deleteProjectMemory(id, memoryId, ownerId)) {
    return Response.json({ error: "Memory not found" }, { status: 404 });
  }
  return Response.json({ ok: true, id: memoryId });
}
