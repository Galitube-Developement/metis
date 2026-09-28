import { config } from "@/lib/config";
import { localWindowsArtifact, WINDOWS_ARTIFACTS } from "@/lib/remote-client-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ filename: string }> };

// Public binary distribution contains no pairing credentials. Authenticated
// installer and update endpoints on each server remain the user-facing paths.
export async function GET(_req: Request, { params }: Params) {
  const { filename } = await params;
  if (!WINDOWS_ARTIFACTS.has(filename)) return Response.json({ error: "Artifact not found" }, { status: 404 });
  return localWindowsArtifact(filename, {
    dataDir: config.dataDir,
    publicCache: true,
  }) || Response.json({ error: "Artifact not found" }, { status: 404 });
}
