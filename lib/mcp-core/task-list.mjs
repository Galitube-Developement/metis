export const TASK_LIST_MAX_ITEMS = 20;
export const TASK_LIST_MAX_CHARS = 4000;

/** Canonical ordered task values. Reject malformed entries rather than dropping user edits. */
export function normalizeTaskList(input) {
  if (!Array.isArray(input) || !input.length || input.length > TASK_LIST_MAX_ITEMS) throw new Error("Provide 1–20 research steps.");
  if (input.some(item => typeof item !== "string" || !item.trim())) throw new Error("Every research step needs text.");
  const tasks = input.map(item => item.trim());
  if (tasks.join("\n").length > TASK_LIST_MAX_CHARS) throw new Error("Research steps may contain at most 4000 characters in total.");
  return tasks;
}
