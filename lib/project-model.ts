import type { ModelParamSelection } from "@/lib/model-params";

export type ProjectModelSettings = {
  defaultModelEnabled?: boolean;
  defaultModelId?: string;
  defaultModelParams?: ModelParamSelection[];
};
export type ProjectModelSelection = { modelId: string; modelParams: ModelParamSelection[] };

export function projectDefaultModel(project: (ProjectModelSettings & { mode?: string }) | null | undefined): ProjectModelSelection | null {
  if (project?.mode !== "agents" || project.defaultModelEnabled !== true || !project.defaultModelId?.trim()) return null;
  return { modelId: project.defaultModelId, modelParams: project.defaultModelParams || [] };
}

export function projectModelLockMessage(projectName: string): string {
  return `Model and options are set in ${projectName}. Change them in Project Hub.`;
}
