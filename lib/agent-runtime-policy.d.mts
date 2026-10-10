export const DEFAULT_AGENT_RUNTIME_MS: number;
export const MAX_AGENT_RUNTIME_MS: number;
export function normalizeAgentRuntimeMs(value?: unknown): number;
export function resolveAgentRuntimeMs(requested?: unknown, configuredDefault?: unknown): number;
export const AGENT_RUNTIME_SCHEMA: { type: "integer"; minimum: number; maximum: number; description: string };
