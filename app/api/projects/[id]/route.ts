import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getGlobalModelSettings, listChatsForUser, updateChat } from "@/lib/db-store";
import { captureApiError } from "@/lib/error-logs";
import { deleteProject, getProject, listProjectFiles, updateProject } from "@/lib/projects";
import { listNotes } from "@/lib/shared-context";
import { listSkillSettings, projectSkillSettings } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  const project = getProject(id, ownerId);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    project,
    files: listProjectFiles(id, ownerId),
    notes: listNotes({ ownerId }).filter((note) => note.projectId === id),
    chats: listChatsForUser(ownerId).filter((chat) => chat.projectId === id),
    skills: listSkillSettings(projectSkillSettings(getGlobalModelSettings(ownerId), project)),
  });
}

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      icon?: string;
      color?: string;
      instructions?: string;
      memoryMode?: "default" | "project_only";
      disabledSkillIds?: string[];
    };
    const project = updateProject(id, body, ownerId);
    if (!project) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ project });
  } catch (error) {
    captureApiError("/api/projects/[id] PATCH", error, req);
    return Response.json({ error: "Could not update project" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const { id } = await params;
  const result = deleteProject(id, ownerId);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  for (const chatId of result.chatIds) updateChat(chatId, { projectId: null }, ownerId);
  return Response.json({ ok: true });
}
