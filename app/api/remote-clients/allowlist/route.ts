import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getGlobalRemoteAllowlist, setGlobalRemoteAllowlist } from "@/lib/remote-clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ allowlist: getGlobalRemoteAllowlist(ownerId) });
}

export async function PUT(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { allowlist?: unknown };
  if (!Array.isArray(body.allowlist) || body.allowlist.some((item) => typeof item !== "string")) {
    return Response.json({ error: "Allowlist must be an array of commands" }, { status: 400 });
  }
  return Response.json({ allowlist: setGlobalRemoteAllowlist(ownerId, body.allowlist) });
}
