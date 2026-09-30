export type WorkspaceDraftPatch = { name?: string; content?: string };

export function mergeIncomingWorkspace<T extends { name: string; content: string; version?: number }>(
  server: T,
  local?: T,
  pending?: WorkspaceDraftPatch,
): T {
  if (local && (local.version || 0) > (server.version || 0)) return { ...local, ...pending };
  return { ...server, ...pending };
}

export function remainingWorkspaceDraft(
  pending: WorkspaceDraftPatch | undefined,
  saved: { name: string; content: string },
): WorkspaceDraftPatch | undefined {
  if (!pending) return undefined;
  const remaining = { ...pending };
  if (remaining.name === saved.name) delete remaining.name;
  if (remaining.content === saved.content) delete remaining.content;
  return Object.keys(remaining).length ? remaining : undefined;
}
