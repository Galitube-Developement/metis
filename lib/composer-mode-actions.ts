import type { ComposerMentionQuery } from "@/lib/composer-references";
import { DEEP_RESEARCH_MODE_ID } from "@/lib/deep-research";

export function showDeepResearchAction(menu: { kind: string | null; query: string } | null) {
  if (!menu || menu.kind) return false;
  const query = menu.query.trim().toLowerCase();
  return "deep research".includes(query) || ["deep-research", "recherche", "tiefenrecherche"].includes(query);
}

/** Consume the action token only if it still matches the live composer. */
export function consumeModeMention(text: string, mention: ComposerMentionQuery) {
  const { start, end, query } = mention;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length
    || text.slice(start, end) !== "@" + query) return null;
  return { value: text.slice(0, start) + text.slice(end), cursor: start, modeId: DEEP_RESEARCH_MODE_ID };
}
