import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  deleteNote,
  getNote,
  listNoteActivities,
  NoteConflictError,
  NoteValidationError,
  notePageInputFromBody,
  updateNote,
  type NoteWriteInput,
} from "@/lib/shared-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function patchFromBody(body: Record<string, unknown>): NoteWriteInput {
  const position = body.position && typeof body.position === "object" ? body.position as Record<string, unknown> : undefined;
  const size = body.size && typeof body.size === "object" ? body.size as Record<string, unknown> : undefined;
  return {
    ...notePageInputFromBody(body),
    title: typeof body.title === "string" ? body.title : undefined,
    content: typeof body.content === "string" ? body.content : undefined,
    kind: body.kind === "project" || body.kind === "note" ? body.kind : undefined,
    todos: Array.isArray(body.todos) ? body.todos as NoteWriteInput["todos"] : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
    position: position ? { x: Number(position.x), y: Number(position.y) } : undefined,
    size: size ? { width: Number(size.width), height: Number(size.height) } : undefined,
    archived: typeof body.archived === "boolean" ? body.archived : undefined,
    projectId: body.projectId === null ? null : typeof body.projectId === "string" ? body.projectId.trim() : undefined,
    expectedVersion: typeof body.version === "number" ? body.version : typeof body.expectedVersion === "number" ? body.expectedVersion : undefined,
    author: body.author === "agent" ? "agent" : "user",
  };
}

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  const note = getNote(id, userId);
  if (!note) return Response.json({ error: "Note not found" }, { status: 404 });
  return Response.json({ note, activities: listNoteActivities(id, userId) });
}

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const note = updateNote(id, {
      ...patchFromBody(body),
      ownerId: userId,
      idempotencyKey: req.headers.get("idempotency-key") || undefined,
    });
    if (!note) return Response.json({ error: "Note not found" }, { status: 404 });
    return Response.json({ note });
  } catch (error) {
    if (error instanceof NoteConflictError) {
      return Response.json({ error: error.message, note: error.current }, { status: 409 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Could not update note" }, { status: error instanceof NoteValidationError ? error.status : 400 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
  if (body.confirm !== true) return Response.json({ error: "Deletion requires confirmation" }, { status: 400 });
  try {
    if (!deleteNote(id, userId)) return Response.json({ error: "Note not found" }, { status: 404 });
    return Response.json({ ok: true, id });
  } catch (error) {
    if (error instanceof NoteValidationError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
