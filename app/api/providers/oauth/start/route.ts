import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { createOAuthFlow, updateOAuthFlow } from "@/lib/oauth-flows";
import { getProviderConnection, upsertProviderConnection } from "@/lib/provider-connections";
import { runOAuthFlow } from "@/lib/providers/oauth";

const OAUTH_PROVIDERS = new Set(["codex", "claude-code", "antigravity"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const providerKey = typeof body.providerKey === "string" ? body.providerKey.trim() : "";
  if (!OAUTH_PROVIDERS.has(providerKey)) {
    return Response.json({ error: "This provider does not expose the supported OAuth flow." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() || undefined : undefined;
  const existing = id ? getProviderConnection(id, ownerId) : null;
  if (id && (!existing || existing.providerKey !== providerKey || existing.authType !== "oauth")) {
    return Response.json({ error: "OAuth connection not found." }, { status: 404 });
  }
  const slug = existing?.slug || (typeof body.slug === "string" ? body.slug.trim() : `${providerKey}-oauth`);
  const label = typeof body.label === "string" ? body.label.trim() : `${providerKey} OAuth`;
  const config =
    body.config && typeof body.config === "object" && !Array.isArray(body.config)
      ? body.config as Record<string, unknown>
      : undefined;
  try {
    const connection = upsertProviderConnection(ownerId, {
      ...(id ? { id } : {}),
      providerKey,
      slug,
      label,
      authType: "oauth",
      config: { ...existing?.config, ...(config || {}), pendingOAuthFlow: true },
      enabled: true,
    });
    if (!connection) throw new Error("Could not create OAuth connection.");
    const flow = createOAuthFlow({
      ownerId,
      connectionId: connection.id,
      providerKey,
    });
    void runOAuthFlow({
      flowId: flow.id,
      ownerId,
      connectionId: connection.id,
      providerKey: providerKey as "codex" | "claude-code" | "antigravity",
      deviceAuth: providerKey === "codex",
    }).catch((error) => {
      updateOAuthFlow(flow.id, ownerId, {
        status: "error",
        error: error instanceof Error ? error.message : "OAuth login failed.",
      });
    });
    return Response.json({ flow }, { status: 202 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to start OAuth flow." },
      { status: 400 },
    );
  }
}
