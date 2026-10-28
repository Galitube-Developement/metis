import { sanitizeModelParams, type ModelParameterModel, type ModelParamSelection } from "@/lib/model-params";
import { CONTEXT_COMPACT_RATIO } from "@/lib/context-window";

/** Per invocation, including resume; never writes account-wide config.toml. */
export function codexContextConfig(model: ModelParameterModel | undefined, params?: ReadonlyArray<ModelParamSelection>): Record<string, number> {
  if (!model) return {};
  const value = sanitizeModelParams(model, params).find(param => param.id === "context")?.value;
  if (!value) return {};
  const tokens = Number(value);
  if (!Number.isSafeInteger(tokens) || tokens < 1024) return {};
  return {
    model_context_window: tokens,
    model_auto_compact_token_limit: Math.floor(tokens * CONTEXT_COMPACT_RATIO),
  };
}
