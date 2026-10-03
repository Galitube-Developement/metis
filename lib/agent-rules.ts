import type { AgentRule, GlobalModelSettings } from "@/lib/store";

export const MAX_AGENT_RULES = 100;
export const MAX_AGENT_RULE_CHARS = 20_000;

export function agentRulesForSettings(settings: Pick<GlobalModelSettings, "agentRules" | "responseInstructions">): AgentRule[] {
  if (Array.isArray(settings.agentRules)) return settings.agentRules;
  const legacy = settings.responseInstructions?.trim();
  return legacy ? [{ id: "legacy-response-instructions", content: legacy }] : [];
}

export function agentRulesValidationError(rules: AgentRule[]): string | undefined {
  if (rules.length > MAX_AGENT_RULES) return `You can save up to ${MAX_AGENT_RULES} rules.`;
  if (rules.some(rule => !rule.content.trim())) return "A rule cannot be empty.";
  if (rules.reduce((total, rule) => total + rule.content.length, 0) > MAX_AGENT_RULE_CHARS) {
    return "Your rules can contain up to 20,000 characters in total.";
  }
}

export function agentRulesPrompt(settings: Pick<GlobalModelSettings, "agentRules" | "responseInstructions">): string {
  const rules = agentRulesForSettings(settings);
  if (!rules.length) return "";
  return "Agent Rules (apply when relevant):\n" + rules.map((rule, index) => `${index + 1}. ${rule.content}`).join("\n\n");
}
