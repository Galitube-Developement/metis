import { getAuthenticatedUser, isAuthenticated } from "@/lib/auth";
import { performSharedBrowserAction } from "@/lib/shared-browser-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrowserRequest = {
  action?: string;
  uploadIds?: string[];
  chatId?: string;
  tabId?: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  x?: number;
  y?: number;
  deltaY?: number;
  width?: number;
  height?: number;
};

async function ownerId(req: Request) {
  const user = await getAuthenticatedUser(req);
  return user?.id || user?.username || null;
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const owner = await ownerId(req);
  const chatId = url.searchParams.get("chatId")?.trim();
  if (!owner || !chatId) return Response.json({ error: "A chatId is required" }, { status: 400 });
  try {
    const result = await performSharedBrowserAction(owner, chatId, {
      action: url.searchParams.get("action") || "screenshot",
      tabId: url.searchParams.get("tabId") || undefined,
      source: "user",
    });
    if (url.searchParams.get("format") === "image" && result.screenshot) {
      return new Response(Buffer.from(result.screenshot, "base64"), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
      });
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Browser request failed" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const owner = await ownerId(req);
  let body: BrowserRequest;
  try {
    body = (await req.json()) as BrowserRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const chatId = body.chatId?.trim();
  if (!owner || !chatId || !body.action) return Response.json({ error: "chatId and action are required" }, { status: 400 });
  try {
    const result = await performSharedBrowserAction(owner, chatId, { ...body, action: body.action, source: "user" });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Browser action failed" }, { status: 400 });
  }
}
