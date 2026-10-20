"use client";
import { Telescope } from "lucide-react";
import { cn } from "@/lib/utils";

export function ResearchModeOption({ index, selected, onSelect, onHighlight }: {
  index: number; selected: boolean; onSelect: () => void; onHighlight: () => void;
}) {
  return <button type="button" role="option" id={`composer-reference-option-${index}`}
    aria-selected={selected} aria-label="Deep Research" onMouseDown={event => event.preventDefault()}
    onMouseEnter={onHighlight} onClick={onSelect}
    className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-muted-foreground hover:bg-muted hover:text-foreground", selected && "bg-muted text-foreground")}>
    <Telescope className="size-4 shrink-0" aria-hidden="true" />
    <span className="min-w-0 flex-1"><span className="block text-xs font-medium">Deep Research</span>
      <span className="block text-[11px] text-muted-foreground">Research a topic with verified sources</span></span>
    <span className="text-[10px] text-muted-foreground">Mode</span>
  </button>;
}
