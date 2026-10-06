import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getNote } from "@/lib/shared-context";
import { storeNoteFiles } from "@/lib/note-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const { id } = await params;
  if (!getNote(id, ownerId)) return Response.json({ error: "Note not found" }, { status: 404 });
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    const attachments = await storeNoteFiles(id, files, ownerId);
    return Response.json({ attachments });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not upload files." }, { status: 400 });
  }
}
