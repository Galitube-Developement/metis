import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getRemoteClient } from "@/lib/remote-clients";
import { requestRemoteClient } from "@/lib/remote-client-gateway";
import { normalizeDesktopPermissionStatus, parseHelperPermissionOutput } from "@/lib/remote-desktop-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const MAC_HELPER = "/Applications/Metis AI Remote Client.app/Contents/Resources/app.asar.unpacked/metis-desktop-helper";

export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  const { id } = await params;
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const client = getRemoteClient(id, ownerId);
  if (!client) return Response.json({ error: "Remote client not found" }, { status: 404 });
  if (client.status !== "online") return Response.json({ error: "Remote client is offline" }, { status: 409 });
  if (!client.capabilities.includes("desktop_gui")) {
    return Response.json({ error: "This device has no interactive desktop" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown };
  const prompt = body.prompt === true && String(client.os || "").toLowerCase().includes("mac");
  try {
    const status = prompt ? await promptMacDesktopPermissions(id, ownerId) : await readDesktopPermissionStatus(id, ownerId);
    return Response.json({ status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Desktop permission check failed" }, { status: 400 });
  }
}

async function readDesktopPermissionStatus(clientId: string, ownerId: string) {
  const result = await requestRemoteClient({
    clientId,
    ownerId,
    action: "computer_use",
    params: { operation: "status" },
    source: "user",
    timeoutMs: 20_000,
  });
  return normalizeDesktopPermissionStatus(result);
}

async function promptMacDesktopPermissions(clientId: string, ownerId: string) {
  try {
    const result = await requestRemoteClient({
      clientId,
      ownerId,
      action: "computer_use",
      params: { operation: "request_permissions" },
      source: "user",
      timeoutMs: 20_000,
    });
    return normalizeDesktopPermissionStatus(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/unsupported computer use operation/i.test(message)) throw error;
    const token = Buffer.from(JSON.stringify({ operation: "request_permissions" })).toString("base64");
    const result = await requestRemoteClient({
      clientId,
      ownerId,
      action: "execute_command",
      params: { command: `exec '${MAC_HELPER}' ${token}` },
      source: "user",
      timeoutMs: 20_000,
    }) as { stdout?: string };
    return parseHelperPermissionOutput(result.stdout);
  }
}
