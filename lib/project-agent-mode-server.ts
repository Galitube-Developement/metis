import { getDatabase, parseData } from "@/lib/sqlite";
import { modeById } from "@/lib/modes";
import { projectDefaultModeId, type ProjectAgentModePolicy } from "@/lib/project-agent-mode";
import type { AgentMode } from "@/lib/store";

export function projectModeOverride(projectId: string | undefined, ownerId: string | undefined): string | null {
  if (!projectId || !ownerId) return null;
  const project = parseData<ProjectAgentModePolicy>(getDatabase()
    .prepare("SELECT data FROM projects WHERE id = ? AND owner_id = ?")
    .get(projectId, ownerId));
  return projectDefaultModeId(project);
}

export function projectModeForChat(
  chat: { projectId?: string; ownerId?: string },
  requestedModeId: string | undefined,
  customModes: AgentMode[] = [],
): AgentMode {
  return modeById(projectModeOverride(chat.projectId, chat.ownerId) || requestedModeId, customModes);
}
