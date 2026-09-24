import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  deleteRemoteClient,
  getRemoteClient,
  listRemoteAudit,
  updateRemoteClient,
  type RemotePolicy,
} from "@/lib/remote-clients";
import { disconnectRemoteClient } from "@/lib/remote-client-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  const { id } = await params;
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const client = getRemoteClient(id, ownerId);
  if (!client) return Response.json({ error: "Remote client not found" }, { status: 404 });
  return Response.json({ client, audit: listRemoteAudit(ownerId, id) });
}

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  const { id } = await params;
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    policy?: { mode?: unknown; allowlist?: unknown };
  };
  const policy: RemotePolicy | undefined = body.policy
    ? {
        mode: body.policy.mode === "restricted" || body.policy.mode === "approval_required" || body.policy.mode === "full_access"
          ? body.policy.mode
          : "approval_required",
        allowlist: Array.isArray(body.policy.allowlist)
          ? body.policy.allowlist.filter((item): item is string => typeof item === "string")
          : [],
      }
    : undefined;
  const client = updateRemoteClient(id, ownerId, {
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(policy ? { policy } : {}),
  });
  if (!client) return Response.json({ error: "Remote client not found or revoked" }, { status: 404 });
  return Response.json({ client });
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  const { id } = await params;
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!deleteRemoteClient(id, ownerId)) return Response.json({ error: "Remote client not found" }, { status: 404 });
  disconnectRemoteClient(id);
  return Response.json({ ok: true });
}

