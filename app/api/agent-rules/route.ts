import { randomUUID } from "node:crypto";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getGlobalModelSettings, saveGlobalModelSettings } from "@/lib/db-store";
import { agentRulesForSettings, agentRulesValidationError } from "@/lib/agent-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  return Response.json({ rules: agentRulesForSettings(getGlobalModelSettings(ownerId)) });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { content?: unknown } | null;
  if (!body || typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "A rule cannot be empty." }, { status: 400 });
  }
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const settings = getGlobalModelSettings(ownerId);
  const rules = [...agentRulesForSettings(settings), { id: randomUUID(), content: body.content.trim() }];
  const error = agentRulesValidationError(rules);
  if (error) return Response.json({ error }, { status: 400 });
  saveGlobalModelSettings({ ...settings, agentRules: rules, responseInstructions: rules.map(rule => rule.content).join("\n\n") }, ownerId);
  return Response.json({ rules }, { status: 201 });
}
