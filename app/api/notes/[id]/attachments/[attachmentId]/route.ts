import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { fileResponse } from "@/lib/file-response";
import { getNote } from "@/lib/shared-context";
import { resolveNoteFile } from "@/lib/note-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const { id, attachmentId } = await params;
  if (!getNote(id, ownerId)) return Response.json({ error: "Note not found" }, { status: 404 });
  const attachment = await resolveNoteFile(id, attachmentId, ownerId);
  if (!attachment) return Response.json({ error: "File not found" }, { status: 404 });
  return fileResponse(attachment.path, attachment.meta, req);
}
