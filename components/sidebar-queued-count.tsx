"use client";

/** Shares the hover/focus reveal used by chat actions; touch devices keep it visible. */
export function SidebarQueuedCount({ count }: { count: number }) {
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  const label = `${count} ${count === 1 ? "message" : "messages"} queued`;
  return <span data-sidebar-queued-count={count} title={label} aria-label={label}
    className="max-w-24 shrink-0 overflow-hidden whitespace-nowrap text-[10px] tabular-nums text-muted-foreground opacity-100 transition-[max-width,opacity] duration-150 motion-reduce:transition-none md:max-w-0 md:opacity-0 md:group-hover:max-w-24 md:group-hover:opacity-100 md:group-focus-within:max-w-24 md:group-focus-within:opacity-100 md:group-has-[[data-state=open]]:max-w-24 md:group-has-[[data-state=open]]:opacity-100">
    {count} queued
  </span>;
}
