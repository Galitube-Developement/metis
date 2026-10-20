import type { GlobalModelSettings } from "@/lib/store";
import { enabledSkills, type SkillRecord } from "@/lib/skills";

export const DESIGN_SKILL_IDS = ["ui-ux-pro-max"] as const;

const DIRECT_DESIGN_RE = /\b(?:ui|ux|user interface|oberfl[aä]che|frontend design|web design|design system|design-system|layout|styling|visual design|visuell|typograph(?:y|ie)|palette|theme|theming)\b/i;
const VISUAL_SURFACE_RE = /\b(?:sidebar|sidepanel|panel|composer|button|buttons|modal|dialog|menu|header|navbar|screen|page|seite|website|webapp|app|mobile|handy|responsive|color|colors|colour|farben?|font|schrift|spacing|abst[aä]nd|radius|rounded|boxy|boxi|card|cards|usage|quota)\b/i;
const DESIGN_ACTION_RE = /\b(?:design|redesign|restyle|style|clean|cleaner|polish|modern|professional|pretty|beautiful|fix|fixe|improve|verbesser|change|[aä]nder|remove|entfern|make|mach|mache|looks?|sieht|aussehen|less ai|weniger ai|ai[- ]?(?:look|ish|generated)|templated|template)\b/i;

export function isVisualDesignTask(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (DIRECT_DESIGN_RE.test(text)) return true;
  return VISUAL_SURFACE_RE.test(text) && DESIGN_ACTION_RE.test(text);
}

export function autoSkillActivationPrompt(
  message: string,
  settings?: GlobalModelSettings,
  options: { hasVisualReference?: boolean; installedSkills?: SkillRecord[] } = {},
) {
  if (!isVisualDesignTask(message)) return "";

  const available = new Map((options.installedSkills ?? enabledSkills(settings)).map((skill) => [skill.id, skill]));
  const skills = DESIGN_SKILL_IDS
    .map((id) => available.get(id))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
  if (!skills.length) return "";

  return [
    "Automatic skill routing: UI UX Pro Max is active for this task only.",
    "Before changing visual UI, read this SKILL.md with the read_file tool and follow its workflow. The user's explicit brief and the existing product identity override generic skill advice:",
    skills.map((skill) => `- ${skill.id}: ${skill.skillPath}`).join("\n"),
    "Do not announce or narrate this routing unless asked. For redesign/fix work, inspect the current rendered UI and source before styling.",
    "For meaningful UI changes, verify the rendered result at mobile (~390px), tablet (~768px), and desktop (~1440px) when browser/screenshot tooling is available, then perform one critique/fix pass before reporting completion.",
  ].join("\n");
}
