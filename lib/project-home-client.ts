import type { ProjectMemoryItem } from "@/components/project-memory-manager";
import type { ProjectSkillItem } from "@/components/project-skills-manager";
import { fetchProjectRead, isProjectRecord } from "@/lib/project-read-client";
export type ProjectHomeData = {
 project: {
  id: string;
  name: string;
  mode?: "chat" | "agents";
  allowAgentManagement?: boolean;
  defaultModelEnabled?: boolean;
  defaultModelId?: string;
  defaultModelParams?: Array<{ id: string; value: string }>;
  hideChatsFromAll?: boolean;
  icon: string;
  color: string;
  instructions: string;
  memoryMode: "default" | "project_only";
  disabledSkillIds: string[];
  memories: ProjectMemoryItem[];
  logoStoredName?: string;
  updatedAt?: string;
 };
 files: Array<{ id: string; name: string; mimeType: string; size: number }>;
 notes: Array<{ id: string; title: string; color?: string }>;
 chats: Array<{ id: string; title: string }>;
 skills: ProjectSkillItem[];
};


export function fetchProjectHome(projectId: string, signal?: AbortSignal) {
  return fetchProjectRead(`/api/projects/${encodeURIComponent(projectId)}`, "project",
    (body): body is ProjectHomeData => {
      if (!isProjectRecord(body) || !isProjectRecord(body.project)) return false;
      const p = body.project;
      return p.id === projectId && ["name", "icon", "color", "instructions"].every(key => typeof p[key] === "string") &&
        (p.memoryMode === "default" || p.memoryMode === "project_only") && Array.isArray(p.memories) &&
        p.memories.every(item => isProjectRecord(item) && typeof item.id === "string" && typeof item.content === "string") &&
        Array.isArray(p.disabledSkillIds) && p.disabledSkillIds.every(id => typeof id === "string") &&
        ["files", "notes", "chats", "skills"].every(key => Array.isArray(body[key]) &&
          (body[key] as unknown[]).every(item => isProjectRecord(item) && typeof item.id === "string" &&
            typeof item[key === "files" ? "name" : "title"] === "string")) &&
        (body.files as Record<string, unknown>[]).every(file => typeof file.mimeType === "string" && typeof file.size === "number");
    }, signal);
}
