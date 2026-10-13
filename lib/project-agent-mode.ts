export type ProjectAgentModePolicy = { mode?: string; defaultModeId?: string };

export function projectDefaultModeId(project: ProjectAgentModePolicy | null | undefined): string | null {
  return project?.mode === "agents" ? project.defaultModeId?.trim() || "agent" : null;
}

export function projectModeLockMessage(projectName: string, modeName: string): string {
  return `Default agent is set to ${modeName} in ${projectName}. Change it in Project Hub.`;
}
