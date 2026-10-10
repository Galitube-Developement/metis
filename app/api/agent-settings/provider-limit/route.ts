import { getAuthenticatedUserId } from "@/lib/auth";
import { getProviderLimitResumeEnabled, saveProviderLimitResumeEnabled } from "@/lib/provider-rate-limit-settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (ownerId: string) => Response.json({ enabled: getProviderLimitResumeEnabled(ownerId), defaultEnabled: true }, { headers: { "Cache-Control": "private, no-store" } });
export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  return ownerId ? response(ownerId) : Response.json({ error: "Unauthorized" }, { status: 401 });
}
export async function PATCH(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
  saveProviderLimitResumeEnabled(ownerId, body.enabled);
  return response(ownerId);
}
