import { config } from "@/lib/config";
import { authenticateRemoteClient } from "@/lib/remote-clients";
import { WINDOWS_ARTIFACTS, windowsArtifact } from "@/lib/remote-client-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ filename: string }> };

export async function GET(req: Request, { params }: Params) {
  const clientId = req.headers.get("x-metis-client-id")?.trim();
  const auth = req.headers.get("authorization") || "";
  const credential = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!clientId || !credential || !authenticateRemoteClient(clientId, credential, false)) {
    return Response.json({ error: "Invalid or revoked client credentials" }, { status: 401 });
  }

  const { filename } = await params;
  if (!WINDOWS_ARTIFACTS.has(filename)) return Response.json({ error: "Update artifact not found" }, { status: 404 });

  const response = await windowsArtifact(filename, { dataDir: config.dataDir });
  return response || Response.json({ error: "Update artifact not found" }, { status: 404 });
}
