"use client";

import { useMeasuredTextHeight } from "@/components/use-measured-text-height";

import { type CSSProperties } from "react";

/** Match the goal banner's measured height transition without clipping long prompts. */
export function QueuedPromptPreview({ text }: { text: string }) {

  const [fullTextRef, fullHeight] = useMeasuredTextHeight<HTMLParagraphElement>(text);

  return (
    <div
      className="relative h-4 min-w-0 overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none group-hover/queue:h-[var(--queued-prompt-height)] group-focus-within/queue:h-[var(--queued-prompt-height)]"
      style={{ "--queued-prompt-height": `${fullHeight}px` } as CSSProperties}
    >
      <p aria-hidden="true" className="absolute inset-x-0 top-0 truncate leading-4 text-muted-foreground transition-opacity duration-150 motion-reduce:transition-none group-hover/queue:opacity-0 group-focus-within/queue:opacity-0">
        {text}
      </p>
      <p ref={fullTextRef} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-4 text-muted-foreground opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/queue:opacity-100 group-focus-within/queue:opacity-100">
        {text}
      </p>
    </div>
  );
}
