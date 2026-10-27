import { ChevronRight, RotateCcw } from "lucide-react";
import type { ProviderRetryPart } from "@/lib/provider-retry";

export function ProviderRetryEvent({ event }: { event: ProviderRetryPart }) {
  // Derive the headline so saved retries also use the current, recognizable label.
  const label = `Continuing Run… (${event.attempt}/${event.maxRetries})`;
  return <details data-provider-retry={event.id} className="group my-2 min-w-0 rounded-lg border border-amber-500/25 bg-amber-500/5">
    <summary className="flex min-h-11 w-full cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground/90 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden sm:min-h-8">
      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      <RotateCcw aria-hidden="true" className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span role="status" aria-live="polite" className="min-w-0 break-words">{label}</span>
    </summary>
    <div className="border-t border-amber-500/15 px-3 py-2.5">
      <p className="mb-1.5 text-xs font-medium text-foreground/90">Provider error</p>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs font-normal leading-relaxed text-muted-foreground">{event.detail || "No error details were provided."}</pre>
    </div>
  </details>;
}
