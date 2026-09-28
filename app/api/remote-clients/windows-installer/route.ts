import { isAuthenticated } from "@/lib/auth";
import { config } from "@/lib/config";
import { WINDOWS_INSTALLER, windowsArtifact } from "@/lib/remote-client-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const response = await windowsArtifact(WINDOWS_INSTALLER, {
    dataDir: config.dataDir,
    disposition: "attachment",
  });
  return response || Response.json({
    error: "The Windows Remote Client could not be loaded. Check this server's remote-client-artifacts directory or its Metis distribution connection.",
  }, { status: 503 });
}
