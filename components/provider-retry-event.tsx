import { ChevronRight, RotateCcw } from "lucide-react";
import { activityRowClass } from "@/lib/activity-display";
import type { ProviderRetryPart } from "@/lib/provider-retry";

export function ProviderRetryEvent({ event }: { event: ProviderRetryPart }) {
  return <details className="group my-0.5 min-w-0">
    <summary className={`${activityRowClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
      <RotateCcw className="size-3 shrink-0 opacity-70" />
      <span className="truncate">{event.message}</span>
      <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
    </summary>
    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words pl-4 text-xs font-normal leading-relaxed text-muted-foreground">{event.detail}</pre>
  </details>;
}
