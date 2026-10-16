import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getGlobalModelSettings, saveGlobalModelSettings } from "@/lib/db-store";
import { allModes, normalizeMode } from "@/lib/modes";
import type { AgentMode } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const settings = getGlobalModelSettings(userId);
  return Response.json({ modes: allModes(settings.customModes || []) });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  if (!userId) return Response.json({ error: "Account context is required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Partial<AgentMode>;
  const mode = normalizeMode({
    id: body.id || `custom-${crypto.randomUUID()}`,
    name: body.name || "Custom mode",
    description: body.description || "",
    icon: body.icon || "sliders-horizontal",
    instructions: body.instructions || "",
    allowedCategories: Array.isArray(body.allowedCategories) ? body.allowedCategories : ["read"],
    toolOverrides: body.toolOverrides,
  });
  const settings = getGlobalModelSettings(userId);
  const customModes = [...(settings.customModes || []).filter((item) => item.id !== mode.id), mode].slice(-50);
  saveGlobalModelSettings({ ...settings, customModes }, userId);
  return Response.json({ mode }, { status: 201 });
}

export async function DELETE(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  if (!userId) return Response.json({ error: "Account context is required" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim() || "";
  const settings = getGlobalModelSettings(userId);
  saveGlobalModelSettings({
    ...settings,
    customModes: (settings.customModes || []).filter((mode) => mode.id !== id),
  }, userId);
  return Response.json({ ok: true });
}
