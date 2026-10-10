/** The selection actually passed to a run, never the chat's current settings. */
export function usageConfiguration(
  params?: ReadonlyArray<{ id: string; value: string }> | null,
  contextWindow?: number,
) {
  const value = (ids: string[]) => {
    const raw = params?.find(param => ids.includes(param.id))?.value;
    return typeof raw === "string" && /^[a-z0-9_.-]{1,64}$/i.test(raw.trim())
      ? raw.trim().toLowerCase() : undefined;
  };
  const reasoningEffort = value(["effort", "reasoning"]);
  const speed = value(["speed"]);
  const fast = value(["fast"]);
  // Preserve other advertised speed tiers instead of pretending they are Fast.
  const speedMode = speed ? speed === "default" ? "standard" : speed
    : fast === "true" ? "fast" : fast === "false" ? "standard" : undefined;
  return {
    ...(typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
      ? { configuredContextWindow: Math.round(contextWindow) } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(speedMode ? { speedMode } : {}),
  };
}
