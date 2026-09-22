import { NextResponse } from "next/server";
import { authenticateUser, CHAT_COOKIE } from "@/lib/auth";
import { config } from "@/lib/config";
import { consumeRateLimit, requestClientAddress, resetRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = (await req.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const username = body.username?.trim() || config.chatUsername;
  const address = requestClientAddress(req);
  const rateLimitUsername = username.toLowerCase().slice(0, 128);
  const ipLimit = consumeRateLimit(`auth:ip:${address}`, 30, 15 * 60 * 1000);
  const userLimit = consumeRateLimit(`auth:user:${address}:${rateLimitUsername}`, 10, 15 * 60 * 1000);
  if (!ipLimit.allowed || !userLimit.allowed) {
    const retryAfterSeconds = Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds);
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }
  let result: ReturnType<typeof authenticateUser>;
  try {
    result = authenticateUser(username, body.password ?? "");
  } catch (error) {
    console.error("[auth] Authentication storage is unavailable.", error);
    return NextResponse.json(
      { error: "Authentication storage is unavailable. Check the server and try again." },
      { status: 500 },
    );
  }
  if (!result) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }
  resetRateLimit(`auth:ip:${address}`);
  resetRateLimit(`auth:user:${address}:${rateLimitUsername}`);

  const proto = req.headers.get("x-forwarded-proto") || "http";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CHAT_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge: result.maxAge,
  });
  return res;
}

export async function DELETE(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CHAT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge: 0,
  });
  return res;
}
