/** Agent browser events may reveal a collapsed workspace after three idle minutes. */
export const WORKSPACE_BROWSER_IDLE_MS = 3 * 60 * 1000;
export function canAutoRevealBrowser({ workspaceOpen, lastWorkspaceInteractionAt, now, mobile, activeRun, blocked }: {
  workspaceOpen: boolean; lastWorkspaceInteractionAt: number; now: number;
  mobile: boolean; activeRun: boolean; blocked: boolean;
}) {
  return !workspaceOpen && !mobile && activeRun && !blocked &&
    Number.isFinite(lastWorkspaceInteractionAt) && Number.isFinite(now) &&
    now - lastWorkspaceInteractionAt >= WORKSPACE_BROWSER_IDLE_MS;
}
