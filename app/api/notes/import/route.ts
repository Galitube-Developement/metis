import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { importNoteArchive, noteImportForm } from "@/lib/note-archive";
import { NoteValidationError } from "@/lib/shared-context";
import { getGlobalModelSettings } from "@/lib/db-store";
import { featureFlags } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!featureFlags(getGlobalModelSettings(ownerId)).notes) return Response.json({ error: "Notes are disabled" }, { status: 404 });
  try {
    const form = await noteImportForm(req);
    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File)) throw new NoteValidationError("Choose one Markdown or ZIP file.");
    const requested = form.get("projectId"), parent = form.get("parentId");
    if (requested !== null && typeof requested !== "string" || parent !== null && typeof parent !== "string") throw new NoteValidationError("Project and parent IDs must be strings.");
    const result = await importNoteArchive({
      ownerId, file: files[0],
      projectId: requested === null ? undefined : requested === "none" || !requested.trim() ? null : requested.trim(),
      parentId: !parent || parent === "none" ? null : parent.trim(),
      idempotencyKey: req.headers.get("idempotency-key") || undefined,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not import pages" }, { status: error instanceof NoteValidationError ? error.status : 400 });
  }
}
