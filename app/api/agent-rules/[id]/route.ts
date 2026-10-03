import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getGlobalModelSettings, saveGlobalModelSettings } from "@/lib/db-store";
import { agentRulesForSettings, agentRulesValidationError } from "@/lib/agent-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { content?: unknown } | null;
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "A rule cannot be empty." }, { status: 400 });
  }
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const settings = getGlobalModelSettings(ownerId);
  const current = agentRulesForSettings(settings);
  const { id } = await params;
  if (!current.some(rule => rule.id === id)) return Response.json({ error: "Not found" }, { status: 404 });
  const content = body.content.trim();
  const rules = current.map(rule => rule.id === id ? { ...rule, content } : rule);
  const error = agentRulesValidationError(rules);
  if (error) return Response.json({ error }, { status: 400 });
  saveGlobalModelSettings({ ...settings, agentRules: rules, responseInstructions: rules.map(rule => rule.content).join("\n\n") }, ownerId);
  return Response.json({ rules });
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const settings = getGlobalModelSettings(ownerId);
  const current = agentRulesForSettings(settings);
  const { id } = await params;
  if (!current.some(rule => rule.id === id)) return Response.json({ error: "Not found" }, { status: 404 });
  const rules = current.filter(rule => rule.id !== id);
  saveGlobalModelSettings({ ...settings, agentRules: rules, responseInstructions: rules.map(rule => rule.content).join("\n\n") }, ownerId);
  return Response.json({ rules });
}
