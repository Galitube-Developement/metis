import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getNote } from "@/lib/shared-context";
import { readNoteFile } from "@/lib/note-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const { id, attachmentId } = await params;
  if (!getNote(id, ownerId)) return Response.json({ error: "Note not found" }, { status: 404 });
  const attachment = await readNoteFile(id, attachmentId, ownerId);
  if (!attachment) return Response.json({ error: "File not found" }, { status: 404 });
  return new Response(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.data.length),
      "Content-Disposition": `${attachment.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
