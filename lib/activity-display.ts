export const activityRowClass =
  "inline-flex max-w-full cursor-pointer items-center gap-1 appearance-none rounded-none border-0 bg-transparent p-0 text-left text-[11px] font-light text-muted-foreground/70 shadow-none ring-0 outline-none transition-colors hover:bg-transparent hover:text-muted-foreground focus-visible:ring-0";

export function formatThinkingDuration(ms?: number): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10 && !Number.isInteger(s)) return `${s.toFixed(1)}s`;
  return `${Math.round(s)}s`;
}
