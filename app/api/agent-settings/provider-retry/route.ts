import { getAuthenticatedUserId } from "@/lib/auth";
import { getProviderRetryEnabled, saveProviderRetryEnabled } from "@/lib/provider-retry-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const response = (ownerId: string) => Response.json({
  enabled: getProviderRetryEnabled(ownerId), defaultEnabled: false,
}, { headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  return ownerId ? response(ownerId) : Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PATCH(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
  saveProviderRetryEnabled(ownerId, body.enabled);
  return response(ownerId);
}
