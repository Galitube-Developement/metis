import { requireHostAdmin as requireAdmin } from "@/lib/api-auth";
import { deleteManagedUser, patchManagedUser } from "@/lib/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    workspaceRoot?: string;
    password?: string;
    isAdmin?: boolean;
    osUsername?: string | null;
  };
  try {
    const user = patchManagedUser(id, { ...body, actorUserId: auth.userId });
    return Response.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update user.";
    const status = /not found/i.test(message) ? 404 : /last admin/i.test(message) ? 409 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireAdmin(req);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await params;
  try {
    deleteManagedUser(id, auth.userId);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete user.";
    const status = /not found/i.test(message)
      ? 404
      : /own account|last admin/i.test(message)
        ? 409
        : 400;
    return Response.json({ error: message }, { status });
  }
}
