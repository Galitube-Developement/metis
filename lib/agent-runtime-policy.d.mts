export const DEFAULT_AGENT_RUNTIME_MS: number;
export const MIN_AGENT_RUNTIME_MS: number;
export const UNLIMITED_AGENT_RUNTIME_MS: 0;
export function normalizeAgentRuntimeMs(value?: unknown): number;
export function resolveAgentRuntimeMs(requested?: unknown, configuredDefault?: unknown): number;
export function agentRuntimeDeadline(start: number, runtimeMs: number): number;
export function workerRuntimeMs(job: { parentJobId?: string; projectTeamId?: string; maxRuntimeMs?: number } | null, fallback: number): number;
export function scheduleRuntimeDeadline(deadline: number, expire: () => void): () => void;
export const AGENT_RUNTIME_SCHEMA: { type: "integer"; minimum: number; anyOf: ({ const: number } | { minimum: number })[]; description: string };
