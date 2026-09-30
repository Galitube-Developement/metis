import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { approveRemoteApproval } from "@/lib/remote-clients";
import { getApproval } from "@/lib/db-approvals";
import { resolveActionApproval } from "@/lib/remote-approval-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  const { id } = await params;
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const approved = id && (getApproval(id, ownerId)
    ? resolveActionApproval(id, "allow", ownerId)
    : approveRemoteApproval(id, ownerId));
  if (!approved) {
    return Response.json({ error: "Approval request is missing, expired, already used, or belongs to another account" }, { status: 409 });
  }
  return Response.json({ ok: true });
}
