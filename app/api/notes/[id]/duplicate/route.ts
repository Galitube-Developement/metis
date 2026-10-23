import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { duplicateNoteSubtree } from "@/lib/note-archive";
import { NoteConflictError, NoteValidationError } from "@/lib/shared-context";
import { getGlobalModelSettings } from "@/lib/db-store";
import { featureFlags } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!featureFlags(getGlobalModelSettings(ownerId)).notes) return Response.json({ error: "Notes are disabled" }, { status: 404 });
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (Object.hasOwn(body, "version") && typeof body.version !== "number") throw new NoteValidationError("version must be a positive integer.");
    if (Object.hasOwn(body, "parentId") && body.parentId !== null && typeof body.parentId !== "string") throw new NoteValidationError("parentId must be an ID or null.");
    const result = await duplicateNoteSubtree({
      id, ownerId,
      expectedVersion: typeof body.version === "number" ? body.version : undefined,
      parentId: body.parentId === null ? null : typeof body.parentId === "string" ? body.parentId : undefined,
      idempotencyKey: req.headers.get("idempotency-key") || undefined,
    });
    if (!result) return Response.json({ error: "Note not found" }, { status: 404 });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof NoteConflictError) return Response.json({ error: error.message, note: error.current }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "Could not duplicate tree" }, { status: error instanceof NoteValidationError ? error.status : 400 });
  }
}
