import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getNote } from "@/lib/shared-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const { id } = await params;
  const note = getNote(id, ownerId);
  if (!note || note.kind === "learned_fact") return Response.json({ error: "Note not found" }, { status: 404 });
  const name = note.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim() || "Untitled";
  return new Response(note.content, { headers: {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="page.md"; filename*=UTF-8''${encodeURIComponent(name + ".md").replace(/'/g, "%27")}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } });
}
