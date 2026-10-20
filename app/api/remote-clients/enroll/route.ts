import { registerRemoteClient } from "@/lib/remote-clients";
import { getNotificationPrefs, setNotificationPrefs } from "@/lib/notification-store";
import { transaction } from "@/lib/sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: unknown;
    name?: unknown;
    os?: unknown;
    architecture?: unknown;
    version?: unknown;
    hostname?: unknown;
    capabilities?: unknown;
    permissionMode?: unknown;
  };
  if (typeof body.token !== "string" || !body.token.trim()) {
    return Response.json({ error: "Enrollment token is required" }, { status: 400 });
  }
  const token = body.token.trim();
  const result = transaction(() => {
    const enrolled = registerRemoteClient(token, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.os === "string" ? { os: body.os } : {}),
      ...(typeof body.architecture === "string" ? { architecture: body.architecture } : {}),
      ...(typeof body.version === "string" ? { version: body.version } : {}),
      ...(typeof body.hostname === "string" ? { hostname: body.hostname } : {}),
      permissionMode: body.permissionMode === "admin" ? "admin" : "user",
      capabilities: Array.isArray(body.capabilities)
        ? body.capabilities.filter((item): item is string => typeof item === "string")
        : [],
    });
    if (enrolled?.client) {
      const prefs = getNotificationPrefs(enrolled.client.ownerId);
      // New devices start selected. Keep the global mute and other device choices.
      if (!prefs.remoteClientIds.includes(enrolled.client.id) && prefs.remoteClientIds.length < 50) {
        setNotificationPrefs(enrolled.client.ownerId, { remoteClient: { id: enrolled.client.id, enabled: true } });
      }
    }
    return enrolled;
  });
  if (!result) return Response.json({ error: "Enrollment token is invalid, expired, or already used" }, { status: 401 });
  return Response.json(result, { status: 201 });
}

