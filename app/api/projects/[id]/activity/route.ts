import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { actOnProjectHandoff, syncProjectHandoffStatuses } from "@/lib/project-team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ handoffs: syncProjectHandoffStatuses(id, ownerId) });
}

export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { handoffId?: string; action?: "cancel" | "retry" };
  if (!body.handoffId || (body.action !== "cancel" && body.action !== "retry")) return Response.json({ error: "handoffId and action are required" }, { status: 400 });
  try { const handoff = actOnProjectHandoff(id, body.handoffId, body.action, ownerId);
   if (!handoff) return Response.json({ error: "Not found" }, { status: 404 });
   return Response.json({ handoff });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not update handoff" }, { status: 400 }); }
}
