import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function dispatch(req: Request, name: string, args: Record<string, unknown>) {
  const userId = await getAuthenticatedUserId(req);
  // @ts-expect-error The canonical gateway runtime is ESM without generated declarations.
  const { dispatchGatewayTool } = await import("@/packages/mcp-gateway/index.mjs");
  const result = await dispatchGatewayTool(name, args, { context: { userId, isHostAdmin: isHostAdmin(userId) } });
  const text = result.content?.map((item: { text?: string }) => item.text || "").join("\n") || "{}";
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}
export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(req.url).searchParams.get("q")?.trim();
  if (!query || query.length > 200) return Response.json({ error: "Enter a search of 1–200 characters." }, { status: 400 });
  try { return Response.json(await dispatch(req, "search_registry", { query, limit: 16, installable_only: true })); }
  catch { return Response.json({ error: "Could not reach the connection catalog. Try again or add a custom connection." }, { status: 502 }); }
}
export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHostAdmin(await getAuthenticatedUserId(req))) return Response.json({ error: "A host administrator must set up new server connections." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200) return Response.json({ error: "Select a connection from the catalog." }, { status: 400 });
  try {
    const result = await dispatch(req, "provision_registry_server", { name: body.name, method: "auto", enable: true, probe: true });
    return Response.json({ enabled: Boolean(result.enabled), gatewayId: result.gatewayId, missingRequiredSecrets: result.missingRequiredSecrets || [], error: result.enabled ? undefined : "This connection needs additional configuration. Review its credentials or use a custom connection." });
  } catch { return Response.json({ error: "Connection setup failed. Try again or add the connection manually." }, { status: 502 }); }
}
