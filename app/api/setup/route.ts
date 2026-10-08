import { NextResponse } from "next/server";
import { authenticateUser, CHAT_COOKIE, getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { patchManagedUser } from "@/lib/admin-users";
import { bootstrapSetupAccount, SetupBootstrapError, getSetupStatus, markSetupComplete } from "@/lib/setup";
import { isHostAdmin, inferOsUsernameForWorkspace, listHostOsUsers } from "@/lib/user-access";
import { hostPlatform } from "@/lib/user-isolation";
import { config } from "@/lib/config";
import { requestIsSecure } from "@/lib/request-network";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sessionCookie(res: NextResponse, token: string, maxAge: number, req: Request) {
  res.cookies.set(CHAT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(req),
    path: "/",
    maxAge,
  });
  return res;
}

export async function GET(req: Request) {
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const status = getSetupStatus(ownerId);
  const canListOsUsers = Boolean(ownerId && isHostAdmin(ownerId));
  return Response.json({
    ...status,
    platform: hostPlatform(),
    osUsers: canListOsUsers
      ? listHostOsUsers().map(({ username, home }) => ({ username, home }))
      : [],
    suggestedOsUsername: canListOsUsers ? inferOsUsernameForWorkspace(config.agentCwd) || "" : "",
  });
}

export async function POST(req: Request) {
  const parsed: unknown = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Response.json({ error: "Invalid setup request." }, { status: 400 });
  }
  const body = parsed as {
    setupToken?: unknown;
    action?: string;
    username?: string;
    password?: string;
    osUsername?: string | null;
  };
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid setup request" }, { status: 400 });
  }
  const action = body.action || "";

  if (action === "bootstrap") {
    // Global bucket: spoofed proxy/address headers cannot bypass this limiter.
    const limit = consumeRateLimit("setup:bootstrap", 10, 60_000);
    if (!limit.allowed) {
      return Response.json({ error: "Too many setup attempts." }, {
        status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
    try {
      const user = bootstrapSetupAccount({
        setupToken: body.setupToken,
        username: typeof body.username === "string" ? body.username : "",
        password: typeof body.password === "string" ? body.password : "",
        osUsername: typeof body.osUsername === "string" ? body.osUsername.trim() || undefined : undefined,
      });
      const session = authenticateUser(user.username, body.password || "");
      if (!session) return Response.json({ error: "Could not sign in after setup." }, { status: 500 });
      const res = NextResponse.json({ ok: true, user, ...getSetupStatus(user.id) }, { status: 201 });
      return sessionCookie(res, session.token, session.maxAge, req);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not create account.";
      return Response.json({ error: cause instanceof SetupBootstrapError ? message : "Could not create account." }, { status: cause instanceof SetupBootstrapError ? cause.status : 400 });
    }
  }

  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getAuthenticatedUserId(req);
  if (!userId || !isHostAdmin(userId)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (action === "os-user") {
    try {
      patchManagedUser(userId, {
        osUsername: body.osUsername ?? null,
        actorUserId: userId,
      });
      return Response.json({ ok: true, ...getSetupStatus(userId) });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not bind OS user.";
      return Response.json({ error: message }, { status: 400 });
    }
  }

  if (action === "complete") {
    markSetupComplete();
    return Response.json({ ok: true, ...getSetupStatus(userId) });
  }

  return Response.json({ error: "Unknown setup action." }, { status: 400 });
}
