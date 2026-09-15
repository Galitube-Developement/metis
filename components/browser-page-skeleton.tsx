"use client";

import { cn } from "@/lib/utils";

export function BrowserPageSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "metis-browser-skeleton absolute inset-0 z-[1] flex flex-col gap-3 bg-[#0d0e10] p-4",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label="Loading page"
    >
      <div className="flex items-center gap-2">
        <span className="metis-browser-skeleton-bone size-2.5 rounded-full" />
        <span className="metis-browser-skeleton-bone h-2.5 w-16 rounded-full" />
        <span className="metis-browser-skeleton-bone h-2.5 w-10 rounded-full" />
      </div>
      <div className="flex h-8 items-center gap-2 rounded-md bg-white/[0.03] px-2">
        <span className="metis-browser-skeleton-bone size-3 rounded-full" />
        <span className="metis-browser-skeleton-bone h-2.5 flex-1 rounded-full" />
      </div>
      <div className="grid flex-1 grid-cols-3 gap-3 pt-1">
        <span className="metis-browser-skeleton-bone col-span-2 rounded-lg" />
        <span className="metis-browser-skeleton-bone rounded-lg" />
        <span className="metis-browser-skeleton-bone rounded-lg" />
        <span className="metis-browser-skeleton-bone col-span-2 rounded-lg" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="metis-browser-skeleton-bone h-2 w-24 rounded-full" />
        <span className="metis-browser-skeleton-bone h-2 w-12 rounded-full" />
      </div>
    </div>
  );
}

export function BrowserPageEmpty({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-[1] flex items-center justify-center bg-[#0d0e10] px-8 text-center text-xs text-zinc-400",
        className,
      )}
    >
      Enter a URL to open it in the server browser.
    </div>
  );
}
