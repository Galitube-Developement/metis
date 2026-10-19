import { getAuthenticatedUser } from "@/lib/auth";
import { getToolRevertSnapshot } from "@/lib/tool-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const user = await getAuthenticatedUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const query = new URL(req.url).searchParams;
  const messageId = query.get("messageId")?.trim() || "";
  const toolId = query.get("toolId")?.trim() || "";
  if (!messageId || !toolId) {
    return Response.json({ error: "messageId and toolId are required" }, { status: 400 });
  }
  const snapshot = getToolRevertSnapshot(id, messageId, toolId, user.id);
  if (!snapshot) return Response.json({ error: "Diff not found" }, { status: 404 });
  return Response.json({ diff: snapshot }, { headers: { "Cache-Control": "private, no-store" } });
}
