import { getAuthenticatedUserId } from "@/lib/auth";
import { getSharedSkill, importSharedSkill } from "@/lib/skill-sharing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };
export async function GET(req: Request, context: Context) {
  const { token } = await context.params;
  const skill = getSharedSkill(token);
  if (!skill) return Response.json({ error: "This share link is unavailable or has been revoked." }, { status: 404 });
  return Response.json({ skill, signedIn: Boolean(await getAuthenticatedUserId(req)) }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
export async function POST(req: Request, context: Context) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Sign in to import this skill." }, { status: 401 });
  const { token } = await context.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") return Response.json({ error: "A skill id is required." }, { status: 400 });
  try { return Response.json({ skill: importSharedSkill(ownerId, token, body.id.trim().toLowerCase()) }, { status: 201 }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not import skill." }, { status: 400 }); }
}
