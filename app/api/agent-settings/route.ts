import { getAuthenticatedUserId } from "@/lib/auth";
import { getGlobalModelSettings, saveGlobalModelSettings } from "@/lib/db-store";
import { transaction } from "@/lib/sqlite";
import { DEFAULT_AGENT_RUNTIME_MS, MIN_AGENT_RUNTIME_MS, normalizeAgentRuntimeMs } from "@/lib/agent-runtime-policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(ownerId: string) {
  return Response.json({
    runtimeMs: normalizeAgentRuntimeMs(getGlobalModelSettings(ownerId).agentRuntimeMs),
    defaultRuntimeMs: DEFAULT_AGENT_RUNTIME_MS,
    minRuntimeMs: MIN_AGENT_RUNTIME_MS,
    maxRuntimeMs: null,
    unlimitedRuntimeMs: 0,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return response(ownerId);
}

export async function PATCH(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { runtimeMs?: unknown } | null;
  const value = body?.runtimeMs;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (value !== 0 && value < MIN_AGENT_RUNTIME_MS) || value % 60_000 !== 0) {
    return Response.json({ error: "Choose at least 15 whole minutes, or Unlimited (0)." }, { status: 400 });
  }
  transaction(() => {
    const settings = getGlobalModelSettings(ownerId);
    saveGlobalModelSettings({ ...settings, agentRuntimeMs: value }, ownerId);
  });
  return response(ownerId);
}
