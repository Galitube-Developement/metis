import type { ProviderModelDefinition } from "./types";

/** The configured URL may be Ollama's origin or its compatible /v1 endpoint. */
export function ollamaBaseUrls(baseUrl: string) {
  const url = new URL(baseUrl);
  url.hash = "";
  url.search = "";
  const pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  const native = `${url.origin}${pathname}`;
  return { native, compatible: `${native}/v1` };
}

export function ollamaModelDetails(value: unknown): Pick<ProviderModelDefinition, "capabilities" | "contextWindow" | "contextWindowSource"> & { completion?: boolean } {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const advertised = Array.isArray(record.capabilities)
    ? record.capabilities.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const capabilities: ProviderModelDefinition["capabilities"] = {
    ...(advertised ? {
      tools: advertised.includes("tools"),
      mcp: advertised.includes("tools"),
      vision: advertised.includes("vision"),
      reasoning: advertised.includes("thinking"),
    } : {}),
  };
  const info = record.model_info && typeof record.model_info === "object"
    ? record.model_info as Record<string, unknown> : {};
  const architecture = info["general.architecture"];
  const context = typeof architecture === "string" ? info[`${architecture}.context_length`] : undefined;
  return {
    capabilities,
    ...(advertised ? { completion: advertised.includes("completion") } : {}),
    ...(typeof context === "number" && Number.isFinite(context) && context > 0
      ? { contextWindow: Math.round(context), contextWindowSource: "provider" as const } : {}),
  };
}
