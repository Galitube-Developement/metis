/** Shared memory routing contract for provider prompts and canonical MCP tools. */
export const MEMORY_SCOPE_GUIDANCE = "Choose scope explicitly: scope chat for current task decisions and progress; scope project for conventions and facts belonging to this shared project; scope global for confirmed, durable owner facts and preferences useful across chats, even when learned in a project chat. Defaults remain project in project chats, otherwise global; do not rely on the default to choose the right scope. Respect the user's memory preferences. Global access is forbidden when Include global memory is off; durable memory is unavailable in Incognito.";

export function memoryWorkingPrompt({ agentMemory = false, includeGlobal = true, incognito = false } = {}) {
  if (incognito) return "";
  const chatLabel = agentMemory ? "agent’s own chat" : "chat";
  return [
    `Keep a small ${agentMemory ? "agent" : "chat"} working memory for decisions, constraints and corrections needed to continue this task. Use add_memory/edit_memory with scope chat at milestones; replace obsolete facts instead of accumulating transcripts. These task facts belong only to this ${chatLabel}. Use scope project for shared project conventions, never for an owner's personal profile.`,
    includeGlobal
      ? "Global memory: proactively save new, confirmed and durable owner facts or preferences that will help in future chats using add_memory with scope global. Examples: a standing communication preference, the user's usual development tools, or a verified device configuration. An explicit 'remember this' phrase is not required. At meaningful milestones or before finishing, check whether this task revealed such information; save only when it adds lasting value, not on every turn. Specify scope global even inside a project chat. For corrections to known global facts, use edit_memory with scope global and the existing ID instead of creating duplicates. A user's explicit opt-out or narrower scope takes precedence."
      : "Include global memory is OFF: do not read or write scope global or personal context-hub data. Account-wide preferences must not be copied into shared project memory as a workaround.",
    "Do not save secrets, inferred or uncertain traits, incidental personal details, ordinary requests, one-off requirements, temporary state, build IDs, process IDs, logs or task summaries as global memory. Do not copy chat working-memory blocks into global memory. Use only the smallest relevant memory slice when checking existing facts; never bulk-load the memory database. Memory writes require a successful tool result before claiming the information was saved.",
  ].join("\n");
}
