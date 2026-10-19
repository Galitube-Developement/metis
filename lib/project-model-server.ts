import { projectForUser, projectRole } from "@/lib/project-access";
import type { Project } from "@/lib/store";
import { getDatabase, parseData } from "@/lib/sqlite";
import { findActiveConnection, getProviderConnection, listProviderModels } from "@/lib/provider-connections";
import { parseModelKey } from "@/lib/providers/types";
import { providerModelIdsMatch } from "@/lib/providers/model-aliases";
import { isModelAllowed } from "@/lib/model-access";
import { defaultParamsForModel, sanitizeModelParams, type ModelParamSelection } from "@/lib/model-params";
import { projectDefaultModel, type ProjectModelSettings } from "@/lib/project-model";

export function discoveredProjectModel(ownerId: string, modelId: string) {
  const selected = parseModelKey(modelId);
  const connection = selected.connectionId ? getProviderConnection(selected.connectionId, ownerId) : findActiveConnection(ownerId, selected.providerKey);
  const model = connection?.enabled && connection.providerKey === selected.providerKey
    ? listProviderModels(connection.id).find(m => providerModelIdsMatch(selected.providerKey, m.id, selected.modelId)) : undefined;
  if (!model) throw new Error("This model has not been discovered. Refresh models in Settings.");
  if (!isModelAllowed(ownerId, modelId)) throw new Error("This model is not available for your account");
  return { id: model.id, displayName: model.displayName, contextWindow: model.contextWindow, parameters: model.parameters, defaultParams: model.defaultParams };
}

export function validateProjectModelSelection(ownerId: string, modelId?: string, params?: ModelParamSelection[]) {
  if (!modelId) return;
  const model = discoveredProjectModel(ownerId, modelId);
  if (params) {
    const valid = sanitizeModelParams(model, params);
    if (valid.length !== params.length || new Set(valid.map(p => p.id)).size !== valid.length) {
      throw new Error("Project model options are no longer supported. Update them in Project Hub.");
    }
  }
}

function invalid(message: string): never {
  const error = new Error(message); error.name = "InvalidProjectModel"; throw error;
}

export function validateProjectModelSettings(settings: ProjectModelSettings, ownerId?: string): ProjectModelSettings {
  if (settings.defaultModelEnabled !== undefined && typeof settings.defaultModelEnabled !== "boolean") invalid("Default model enabled must be a boolean.");
  if (settings.defaultModelId !== undefined && (typeof settings.defaultModelId !== "string" || settings.defaultModelId.length > 300)) invalid("Choose an available default model.");
  const modelId = settings.defaultModelId?.trim();
  if (settings.defaultModelEnabled && !modelId) invalid("Choose a default model before enabling it.");
  const raw = settings.defaultModelParams;
  if (raw !== undefined && (!Array.isArray(raw) || raw.length > 20 || raw.some(p => !p || typeof p.id !== "string" || typeof p.value !== "string"))) invalid("Invalid default model options.");
  let params: ModelParamSelection[] = [];
  if (modelId) {
    if (!ownerId) invalid("Authenticated account required for model selection.");
    try {
      const model = discoveredProjectModel(ownerId, modelId);
      params = raw === undefined ? defaultParamsForModel(model) : sanitizeModelParams(model, raw);
      if (raw && (params.length !== raw.length || new Set(params.map(p => p.id)).size !== params.length)) invalid("Choose options supported by the selected model.");
    } catch (error) { invalid(error instanceof Error ? error.message : "Choose an available default model."); }
  } else if (raw?.length) invalid("Choose a model before setting its options.");
  return { defaultModelEnabled: settings.defaultModelEnabled === true, ...(modelId ? { defaultModelId: modelId } : {}), defaultModelParams: params };
}

export function projectModelOverride(projectId: string | undefined, ownerId: string | undefined) {
  if (!projectId || !ownerId) return null;
  if(!projectRole(projectId,ownerId)) return null;
  const project = parseData<Project>(getDatabase().prepare("SELECT data FROM projects WHERE id = ?").get(projectId));
  return projectDefaultModel(project ? projectForUser(project,ownerId) : null);
}
