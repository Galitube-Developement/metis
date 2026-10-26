import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  getProviderConnection,
  listProviderConnections,
  upsertProviderConnection,
} from "@/lib/provider-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as {
    provider?: unknown;
    endpoint?: unknown;
    apiKey?: unknown;
  };
  const provider = body.provider === "custom" ? "custom" : "openai";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return Response.json({ error: "API key is required." }, { status: 400 });
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  try {
    // Voice settings replace their dedicated credential explicitly; ordinary
    // provider creation no longer identifies an account by its slug.
    const existing = listProviderConnections(ownerId).find(
      (connection) => (connection.slug === `voice-${provider}`
        || (connection.slug.startsWith(`voice-${provider}-`)
          && /^\d+$/.test(connection.slug.slice(`voice-${provider}-`.length))))
        && connection.providerKey === "openai"
        && connection.config.purpose === "voice",
    );
    const saved = upsertProviderConnection(ownerId, {
      ...(existing ? { id: existing.id } : {}),
      providerKey: "openai",
      slug: existing?.slug ?? `voice-${provider}`,
      label: provider === "custom" ? "Voice custom endpoint" : "Voice OpenAI",
      authType: "api_key",
      ...(endpoint ? { baseUrl: endpoint } : {}),
      config: { purpose: "voice" },
      secret: apiKey,
      enabled: true,
    });
    if (!saved) throw new Error("Could not save voice credentials.");
    return Response.json({
      connectionId: saved.id,
      configured: Boolean(getProviderConnection(saved.id, ownerId)?.hasSecret),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save voice credentials." }, { status: 400 });
  }
}
