/** An explicit close is respected briefly; new chats and empty panes reveal immediately. */
export const WORKSPACE_BROWSER_IDLE_MS = 3 * 60 * 1000;
export function canAutoRevealBrowser({ workspaceOpen, workspaceTab, hasWorkspaceDocument, lastWorkspaceDismissedAt, now, mobile, activeRun, blocked }: {
  workspaceOpen: boolean; workspaceTab: string; hasWorkspaceDocument: boolean;
  lastWorkspaceDismissedAt: number | null; now: number;
  mobile: boolean; activeRun: boolean; blocked: boolean;
}) {
  if (mobile || !activeRun || blocked) return false;
  // Empty document placeholders are available; every other selected tab belongs to the user.
  if (workspaceOpen && (hasWorkspaceDocument || (workspaceTab !== "canvas" && workspaceTab !== "plan"))) return false;
  return lastWorkspaceDismissedAt === null || (
    Number.isFinite(lastWorkspaceDismissedAt) && Number.isFinite(now) &&
    now - lastWorkspaceDismissedAt >= WORKSPACE_BROWSER_IDLE_MS
  );
}
