import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";
// @ts-expect-error The canonical Registry runtime is ESM without generated declarations.
import { searchCatalog, provision } from "@/lib/mcp-core/registry-manager.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(req.url).searchParams.get("q")?.trim();
  if (!query || query.length > 200) return Response.json({ error: "Enter a search of 1–200 characters." }, { status: 400 });
  try {
    return Response.json(await searchCatalog({ query, limit: 16, installableOnly: true }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not reach the official MCP Registry. Try again or add a custom connection." }, { status: 502 });
  }
}
export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHostAdmin(await getAuthenticatedUserId(req))) return Response.json({ error: "A host administrator must set up new server connections." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || typeof body.name !== "string" || !body.name.trim() || body.name.length > 200 ||
      typeof body.optionId !== "string" || !/^(remote|package):[0-9]+$/.test(body.optionId)) {
    return Response.json({ error: "Select a connection and method from the catalog." }, { status: 400 });
  }
  try {
    const result = await provision(body.name, { optionId: body.optionId, configuration: body.configuration || {}, enable: true, probe: true });
    const missing = result.missingRequiredSecrets || [];
    return Response.json({
      enabled: Boolean(result.enabled), gatewayId: result.gatewayId, missingRequiredSecrets: missing,
      error: result.enabled ? undefined : missing.length
        ? "Fill in the required configuration: " + missing.join(", ")
        : "Connection test failed: " + (result.probe?.error || "The MCP server did not respond."),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not set up this connection. Check the selected method and configuration, then try again." }, { status: 400 });
  }
}
