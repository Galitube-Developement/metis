import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { moveNote, notePageInputFromBody, NoteConflictError, NoteValidationError } from "@/lib/shared-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const fields = notePageInputFromBody(body);
    if (Object.hasOwn(body, "projectId") && body.projectId !== null && typeof body.projectId !== "string") {
      throw new NoteValidationError("projectId must be an ID or null.");
    }
    for (const key of ["beforeId", "afterId"] as const) {
      if (Object.hasOwn(body, key) && typeof body[key] !== "string") throw new NoteValidationError(key + " must be a sibling page ID.");
    }
    const note = moveNote(id, {
      parentId: fields.parentId,
      sortKey: fields.sortKey,
      beforeId: typeof body.beforeId === "string" ? body.beforeId : undefined,
      afterId: typeof body.afterId === "string" ? body.afterId : undefined,
      projectId: body.projectId === null ? null : typeof body.projectId === "string" ? body.projectId.trim() : undefined,
      expectedVersion: typeof body.version === "number" ? body.version : typeof body.expectedVersion === "number" ? body.expectedVersion : undefined,
      ownerId,
      idempotencyKey: req.headers.get("idempotency-key") || undefined,
    });
    if (!note) return Response.json({ error: "Note not found" }, { status: 404 });
    return Response.json({ note });
  } catch (error) {
    if (error instanceof NoteConflictError) return Response.json({ error: error.message, note: error.current }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "Could not move page" }, { status: error instanceof NoteValidationError ? error.status : 400 });
  }
}
