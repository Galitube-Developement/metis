import type { GlobalModelSettings } from "@/lib/store";
import { alwaysOnSkillsPrompt, enabledSkills, skillsCatalogPrompt, readSkillMarkdown, isAlwaysOnSkill } from "@/lib/skills";
import { autoSkillActivationPrompt } from "@/lib/skill-routing";

/** Cursor and alternative providers receive the same skill snapshot on every turn. */
export function buildSkillContext(
  message: string,
  settings?: GlobalModelSettings,
  options: { hasVisualReference?: boolean; modeId?: string } = {},
) {
  const installedSkills = enabledSkills(settings);
  const researchSkill = installedSkills.find(skill => skill.id === "deep-research");
  const researchActive = options.modeId === "deep-research"
    || /\b(?:use|nutze|verwende|aktiviere)\s+(?:the\s+|den\s+)?deep[- ]research\b/i.test(message);
  const researchInstructions = researchActive && researchSkill && !isAlwaysOnSkill(researchSkill.id, settings) ? readSkillMarkdown(researchSkill.id, settings) : "";
  return [
    researchInstructions ? `Deep Research skill is active for this task:\n${researchInstructions}` : "",
    skillsCatalogPrompt(settings, installedSkills),
    alwaysOnSkillsPrompt(settings, installedSkills),
    autoSkillActivationPrompt(message, settings, { ...options, installedSkills }),
  ].filter(Boolean).join("\n\n");
}
