import { getAuthenticatedUserId } from "@/lib/auth";
import { cancelTeamGeneration, getTeamGeneration, startTeamGeneration } from "@/lib/team-presets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
 const owner = await getAuthenticatedUserId(req);
 if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
 try {
  const body = await req.json();
  if (body.action === "cancel") {
   const generation = typeof body.id === "string" ? cancelTeamGeneration(body.id, owner) : null;
   return generation ? Response.json({ generation }) : Response.json({ error: "Generation not found" }, { status: 404 });
  }
  return Response.json({ generation: startTeamGeneration(body.prompt, body.modelId, owner) }, { status: 202 });
 } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not generate team" }, { status: 400 }); }
}
export async function GET(req: Request) {
 const owner = await getAuthenticatedUserId(req);
 if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const id = new URL(req.url).searchParams.get("id") || "";
 const generation = getTeamGeneration(id, owner);
 return generation ? Response.json({ generation }) : Response.json({ error: "Generation not found" }, { status: 404 });
}
