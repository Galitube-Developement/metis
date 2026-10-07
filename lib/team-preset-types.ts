export type TeamDraftAgent = {
 key: string;
 name: string;
 role: string;
 systemPrompt: string;
 color: string;
 supervisorKey?: string;
};
export type TeamDraft = { name: string; description: string; agents: TeamDraftAgent[] };
export type TeamPreset = TeamDraft & { id: string; builtIn?: boolean; createdAt?: string; updatedAt?: string };
export type TeamGeneration = {
 id: string;
 status: "queued" | "running" | "ready" | "error" | "cancelled";
 modelId: string;
 createdAt: string;
 draft?: TeamDraft;
 error?: string;
};
export const TEAM_DRAFT_LIMIT = 32;

function stringField(value: unknown, field: string, max: number, required = true) {
 if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error(`Invalid ${field} (maximum ${max} characters)`);
 return value.trim();
}
/** Untrusted provider output is data, never executable tools or an agent identity. */
export function validateTeamDraft(value: unknown): TeamDraft {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A team draft must be a JSON object");
 const draft = value as Record<string, unknown>;
 const name = stringField(draft.name, "preset name", 120);
 const description = stringField(draft.description ?? "", "description", 1000, false);
 if (!Array.isArray(draft.agents) || !draft.agents.length || draft.agents.length > TEAM_DRAFT_LIMIT) throw new Error(`A team needs 1–${TEAM_DRAFT_LIMIT} agents`);
 const agents = draft.agents.map((item: unknown): TeamDraftAgent => {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid agent");
  const a = item as Record<string, unknown>;
  const key = stringField(a.key, "agent key", 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("Agent keys must use letters, numbers, underscores or hyphens");
  const color = stringField(a.color, "avatar color", 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Avatar color must be a six-digit hex color");
  if (a.supervisorKey !== undefined && a.supervisorKey !== null && typeof a.supervisorKey !== "string") throw new Error("Invalid supervisor key");
  return { key, name: stringField(a.name, "agent name", 120), role: stringField(a.role, "role", 120),
   systemPrompt: stringField(a.systemPrompt, "system prompt", 20000, false), color,
   ...(a.supervisorKey ? { supervisorKey: stringField(a.supervisorKey, "supervisor key", 80) } : {}) };
 });
 const byKey = new Map(agents.map(a => [a.key, a]));
 if (byKey.size !== agents.length) throw new Error("Agent keys must be unique");
 for (const a of agents) {
  const seen = new Set([a.key]);
  let key = a.supervisorKey;
  while (key) {
   if (seen.has(key)) throw new Error("Supervising agents cannot form a cycle");
   seen.add(key);
   const supervisor = byKey.get(key);
   if (!supervisor) throw new Error("Supervisor must be part of this draft");
   key = supervisor.supervisorKey;
  }
 }
 return { name, description, agents };
}
export function parseTeamDraftResponse(content: string) {
 const text = content.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
 if (text.length > 700000) throw new Error("AI response is too large");
 try { return validateTeamDraft(JSON.parse(text)); }
 catch (error) { throw new Error(`AI returned an invalid team draft: ${error instanceof Error ? error.message : "invalid JSON"}. Refine your prompt and generate again.`); }
}
