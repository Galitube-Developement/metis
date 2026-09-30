import { isAuthenticated } from "@/lib/auth";
import { WINDOWS_INSTALLER_URL } from "@/lib/remote-client-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.redirect(WINDOWS_INSTALLER_URL, 302);
}
