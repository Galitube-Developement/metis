import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { captureApiError } from "@/lib/error-logs";
import {
  createChat,
  listChatsForUser,
  updateChat,
  type BrowserContext,
} from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const includeArchived =
      new URL(req.url).searchParams.get("includeArchived") === "true";
    return Response.json({
      chats: listChatsForUser(
        (await getAuthenticatedUserId(req)) ?? undefined,
        { includeArchived },
      ),
    });
  } catch (error) {
    captureApiError("/api/chats GET", error, req);
    return Response.json({ error: "Could not list chats" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let body: {
      title?: string;
      browserContext?: BrowserContext;
      modelId?: string;
      modelParams?: Array<{ id: string; value: string }>;
      incognito?: boolean;
      modeId?: string;
      runtimeMode?: string;
      projectId?: string;
    } = {};
    try {
      body = (await req.json()) as {
        title?: string;
        browserContext?: BrowserContext;
        modelId?: string;
        modelParams?: Array<{ id: string; value: string }>;
        incognito?: boolean;
        modeId?: string;
        runtimeMode?: string;
        projectId?: string;
      };
    } catch {
      body = {};
    }

    const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
    let chat = createChat(
      body.title,
      body.browserContext,
      ownerId,
      {
        id: body.modelId?.trim(),
        params: Array.isArray(body.modelParams) ? body.modelParams : undefined,
      },
      { incognito: body.incognito === true, projectId: body.projectId?.trim() || undefined },
    );
    if (body.modeId?.trim() || body.runtimeMode?.trim()) {
      chat = updateChat(chat.id, {
        ...(body.modeId?.trim() ? { sessionState: { modeId: body.modeId.trim().slice(0, 80) } } : {}),
        ...(body.runtimeMode?.trim() ? { runtimeMode: body.runtimeMode.trim() } : {}),
      }, ownerId) || chat;
    }
    return Response.json({ chat }, { status: 201 });
  } catch (error) {
    captureApiError("/api/chats POST", error, req);
    return Response.json({ error: "Could not create chat" }, { status: 500 });
  }
}
