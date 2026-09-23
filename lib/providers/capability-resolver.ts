import type { ProviderCapabilities, ProviderDefinition, ProviderModelDefinition } from './types';

export type VerifiedCapability = {
  requested: ProviderCapabilities;
  verified: Partial<ProviderCapabilities>;
  fallbacks: string[];
  checkedAt: string;
};

export type CapabilityResolutionOptions = {
  includeFallbacks?: boolean;
};

/**
 * Central capability normalization layer.
 * Static provider flags are only the baseline; runtime probes can override these values.
 */
export function resolveCapabilities(
  provider: ProviderDefinition,
  model?: ProviderModelDefinition,
  probe?: Partial<ProviderCapabilities>,
  options: CapabilityResolutionOptions = {},
): VerifiedCapability {
  const requested = {
    ...provider.capabilities,
    ...(model?.capabilities ?? {}),
  };

  const verified: Partial<ProviderCapabilities> = {
    ...requested,
    ...(probe ?? {}),
  };

  if (model?.parameters?.some((parameter) => parameter.id === "effort" || parameter.id === "reasoning")) {
    verified.reasoning = true;
  }
  if (model?.parameters?.some((parameter) => parameter.id === "fast" || parameter.id === "speed")) {
    verified.fast = true;
  }

  const fallbacks: string[] = [];

  if (options.includeFallbacks !== false && !verified.tools) {
    verified.tools = true;
    fallbacks.push('embedded-tool-fallback');
  }

  if (options.includeFallbacks !== false && !verified.agent) {
    verified.agent = true;
    fallbacks.push('metis-agent-runtime');
  }

  return {
    requested,
    verified,
    fallbacks,
    checkedAt: new Date().toISOString(),
  };
}
