import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { cloneChatByShareId } from "@/lib/db-store";
import { consumeSharePasswordLimit } from "@/lib/share-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: string; password?: string };
  try {
    body = (await req.json()) as { id?: string; password?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401 });
  if (!body || typeof body.id !== "string" || body.id.length > 128 ||
      (body.password !== undefined && (typeof body.password !== "string" || body.password.length > 4096))) {
    return Response.json({ error: "Invalid share credentials" }, { status: 400 });
  }
  const rateLimit = consumeSharePasswordLimit(req, body.id);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many password attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }
  const result = cloneChatByShareId(body.id || "", body.password, ownerId);
  if (result.status !== "ok") {
    return Response.json({ error: "This shared chat is unavailable or requires a password." }, { status: 404 });
  }
  rateLimit.reset();
  return Response.json({ chat: result.chat }, { status: 201 });
}
