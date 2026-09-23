import { NextResponse } from "next/server";
import { authenticateUser, CHAT_COOKIE, getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { createManagedUser, patchManagedUser } from "@/lib/admin-users";
import { getSetupStatus, markSetupComplete, markSetupIncomplete } from "@/lib/setup";
import { isHostAdmin, inferOsUsernameForWorkspace, listHostOsUsers } from "@/lib/user-access";
import { hostPlatform } from "@/lib/user-isolation";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sessionCookie(res: NextResponse, token: string, maxAge: number, req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  res.cookies.set(CHAT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge,
  });
  return res;
}

export async function GET(req: Request) {
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const status = getSetupStatus(ownerId);
  const canListOsUsers = status.needed && (!status.hasUsers || (ownerId && isHostAdmin(ownerId)));
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
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    username?: string;
    password?: string;
    osUsername?: string | null;
  };
  const action = body.action || "";

  if (action === "bootstrap") {
    const status = getSetupStatus();
    if (status.hasUsers) {
      return Response.json({ error: "Setup already has an account." }, { status: 409 });
    }
    try {
      const user = createManagedUser({
        username: body.username || "",
        password: body.password || "",
        isAdmin: true,
        osUsername: body.osUsername?.trim() || undefined,
      });
      markSetupIncomplete();
      const session = authenticateUser(user.username, body.password || "");
      if (!session) return Response.json({ error: "Could not sign in after setup." }, { status: 500 });
      const res = NextResponse.json({ ok: true, user, ...getSetupStatus(user.id) }, { status: 201 });
      return sessionCookie(res, session.token, session.maxAge, req);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not create account.";
      return Response.json({ error: message }, { status: 400 });
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
