import { getAuthenticatedUser, isAuthenticated } from "@/lib/auth";
import { installPlaywrightChromium } from "@/lib/playwright-install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await getAuthenticatedUser(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await installPlaywrightChromium();
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playwright browser installation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
