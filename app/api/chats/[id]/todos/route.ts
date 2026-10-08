import { getAuthenticatedUser } from "@/lib/auth";
import { getChatPage } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const page = getChatPage(id, user.id, 1, 0);
  if (!page) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ currentTodos: page.currentTodos }, { headers: { "Cache-Control": "private, no-store" } });
}
