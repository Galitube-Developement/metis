import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { captureApiError } from "@/lib/error-logs";
import { transaction } from "@/lib/sqlite";
import { importTeamDraft } from "@/lib/team-presets";
import { createProjectTeamPreset } from "@/lib/project-team";
import { createProject, listProjects, searchProjects } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
    const query = new URL(req.url).searchParams.get("q")?.trim() || "";
    return Response.json({ projects: query ? searchProjects(query, ownerId) : listProjects(ownerId) });
  } catch (error) {
    captureApiError("/api/projects GET", error, req);
    return Response.json({ error: "Could not list projects" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      mode?: "chat" | "agents";
      teamPreset?: boolean;
      teamDraft?: unknown;
      icon?: string;
      color?: string;
      instructions?: string;
      memoryMode?: "default" | "project_only";
    };
    const project = transaction(() => { const result = createProject({ ...body, ownerId }); if (result.mode === "agents") { if (body.teamDraft) importTeamDraft(result.id, body.teamDraft, ownerId); else if (body.teamPreset === true) createProjectTeamPreset(result.id, ownerId); } return result; });
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    captureApiError("/api/projects POST", error, req);
    return Response.json({ error: "Could not create project" }, { status: 500 });
  }
}
