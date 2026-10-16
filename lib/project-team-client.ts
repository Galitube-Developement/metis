import type { ProjectAgent, ProjectHandoff } from "@/lib/project-team-types";
import { fetchProjectRead, isProjectRecord } from "@/lib/project-read-client";
export type ProjectTeamResponse = { agents: ProjectAgent[]; handoffs: ProjectHandoff[] };
function hasStrings(value: unknown, keys: string[]): value is Record<string, string> {
  return isProjectRecord(value) && keys.every(key => typeof value[key] === "string");
}
export function fetchProjectTeam(projectId: string, signal?: AbortSignal): Promise<ProjectTeamResponse> {
  return fetchProjectRead(`/api/projects/${encodeURIComponent(projectId)}/agents`, "team",
    (body): body is ProjectTeamResponse => isProjectRecord(body) && Array.isArray(body.agents) && Array.isArray(body.handoffs) &&
      body.agents.every(agent => hasStrings(agent, ["id", "projectId", "chatId", "name", "role", "color", "status"]) && agent.projectId === projectId) &&
      body.handoffs.every(handoff => hasStrings(handoff, ["id", "projectId", "recipientAgentId", "task", "status"]) && handoff.projectId === projectId), signal);
}

/** A failed project refresh must not erase its known chat identities. */
export function mergeProjectChatAgents(previous: Record<string, ProjectAgent>, projectIds: readonly string[],
  results: readonly { projectId: string; agents?: ProjectAgent[] }[]) {
  const allowed = new Set(projectIds);
  const next = Object.fromEntries(Object.entries(previous).filter(([, agent]) => allowed.has(agent.projectId)));
  for (const result of results) {
    if (result.agents === undefined) continue;
    for (const [chatId, agent] of Object.entries(next)) if (agent.projectId === result.projectId) delete next[chatId];
    if (allowed.has(result.projectId)) for (const agent of result.agents) next[agent.chatId] = agent;
  }
  return next;
}
