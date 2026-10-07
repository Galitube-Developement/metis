import { getAuthenticatedUserId } from "@/lib/auth";
import { deleteTeamPreset, saveTeamPreset } from "@/lib/team-presets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, { params }: Params) {
 const owner = await getAuthenticatedUserId(req);
 if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
 try { return Response.json({ preset: saveTeamPreset(await req.json(), owner, (await params).id) }); }
 catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not update preset" }, { status: 400 }); }
}
export async function DELETE(req: Request, { params }: Params) {
 const owner = await getAuthenticatedUserId(req);
 if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
 return deleteTeamPreset((await params).id, owner) ? Response.json({ deleted: true }) : Response.json({ error: "Preset not found" }, { status: 404 });
}
