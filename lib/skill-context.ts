import type { GlobalModelSettings } from "@/lib/store";
import { alwaysOnSkillsPrompt, enabledSkills, skillsCatalogPrompt } from "@/lib/skills";
import { autoSkillActivationPrompt } from "@/lib/skill-routing";

/** Cursor and alternative providers receive the same skill snapshot on every turn. */
export function buildSkillContext(
  message: string,
  settings?: GlobalModelSettings,
  options: { hasVisualReference?: boolean } = {},
) {
  const installedSkills = enabledSkills(settings);
  return [
    skillsCatalogPrompt(settings, installedSkills),
    alwaysOnSkillsPrompt(settings, installedSkills),
    autoSkillActivationPrompt(message, settings, { ...options, installedSkills }),
  ].filter(Boolean).join("\n\n");
}
