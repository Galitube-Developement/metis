import { isAuthenticated } from "@/lib/auth";
import { latestWindowsInstallerUrl } from "@/lib/remote-client-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.redirect(await latestWindowsInstallerUrl(), 302);
}
