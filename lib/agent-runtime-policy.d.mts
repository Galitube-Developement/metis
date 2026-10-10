export const DEFAULT_AGENT_RUNTIME_MS: number;
export const MAX_AGENT_RUNTIME_MS: number;
export function normalizeAgentRuntimeMs(value?: unknown): number;
export const AGENT_RUNTIME_SCHEMA: { type: "integer"; minimum: number; maximum: number; default: number; description: string };
