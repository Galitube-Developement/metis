export const AUTOMATION_SIDEBAR_DEFAULT_WIDTH = 480;

export function automationSidebarBounds(containerWidth: number) {
  const available = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
  // Keep the list readable, including when the app's own sidebar is open.
  const max = Math.min(960, Math.max(0, available - Math.min(240, available * 0.4)));
  return { min: Math.min(360, max), max };
}

export function clampAutomationSidebarWidth(width: number, containerWidth: number) {
  const { min, max } = automationSidebarBounds(containerWidth);
  const requested = Number.isFinite(width) ? width : AUTOMATION_SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(max, Math.max(min, requested)));
}
