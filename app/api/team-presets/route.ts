import { getAuthenticatedUserId } from "@/lib/auth";
import { listTeamPresets, saveTeamPreset, teamDraftFromProject } from "@/lib/team-presets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
 const owner = await getAuthenticatedUserId(req);
 if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
 try {
  const projectId = new URL(req.url).searchParams.get("projectId");
  return Response.json(projectId ? { draft: teamDraftFromProject(projectId, owner) } : { presets: listTeamPresets(owner) });
 } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not load presets" }, { status: 400 }); }
}
export async function POST(req: Request) {
 const owner = await getAuthenticatedUserId(req);
 if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
 try { return Response.json({ preset: saveTeamPreset(await req.json(), owner) }, { status: 201 }); }
 catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not save preset" }, { status: 400 }); }
}
