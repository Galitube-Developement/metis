"use client";

import { memo, useLayoutEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";

type GoalReference = {
  kind: string;
  id: string;
  label: string;
};

export const ChatGoalBanner = memo(function ChatGoalBanner({
  goal,
  references,
}: {
  goal: string;
  references: GoalReference[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [fullHeight, setFullHeight] = useState(16);
  const fullTextRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const text = fullTextRef.current;
    if (!text) return;
    const measure = () => setFullHeight(Math.max(16, text.scrollHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [goal]);

  return (
    <div
      className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="status"
      aria-label="Current chat goal"
      tabIndex={0}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
    >
      <div className="flex items-start gap-2">
        <Flag className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div
          className="relative min-w-0 flex-1 overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
          style={{ height: expanded ? fullHeight : 16 }}
        >
          <span
            aria-hidden="true"
            className={`absolute inset-x-0 top-0 block truncate leading-4 text-muted-foreground transition-opacity duration-150 motion-reduce:transition-none ${expanded ? "opacity-0" : "opacity-100"}`}
          >
            Goal: <span className="text-foreground/80">{goal}</span>
          </span>
          <span
            ref={fullTextRef}
            className={`block break-words leading-4 text-muted-foreground transition-opacity duration-150 motion-reduce:transition-none ${expanded ? "opacity-100" : "opacity-0"}`}
          >
            Goal: <span className="text-foreground/80">{goal}</span>
          </span>
        </div>
      </div>
      {references.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Goal context">
          {references.map((reference) => (
            <span key={`${reference.kind}-${reference.id}`} className="rounded-md border border-border/60 bg-muted/25 px-1.5 py-0.5 text-muted-foreground">@{reference.label}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
});
