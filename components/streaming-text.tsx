"use client";

import { useState, type HTMLAttributes } from "react";
import { appendStreamingText, initialStreamingText } from "@/lib/streaming-text";

export function StreamingText({ text, initialFrom = text.length, born }: { text: string; initialFrom?: number; born?: number }) {
  const [state, setState] = useState(() => initialStreamingText(text, Date.now(), initialFrom, born));
  const next = appendStreamingText(state, text, Date.now());
  if (next !== state) setState(next);
  return <>{next.prefix}{next.segments.map(segment => <span key={segment.id} className="stream-token-fade"
    style={segment.delay ? { animationDelay: (-segment.delay) + "ms" } : undefined}>{segment.text}</span>)}</>;
}

// Source offsets prevent a newly parsed Markdown node from replaying old text.
export function StreamingSpan({ node, children, ...props }: HTMLAttributes<HTMLSpanElement> & {
  node?: { properties?: Record<string, unknown> };
}) {
  const properties = node?.properties;
  if (properties?.["data-metis-stream-text"] && typeof children === "string") return <StreamingText text={children}
    initialFrom={Number(properties["data-metis-stream-from"] ?? 0)} born={typeof properties["data-metis-stream-born"] === "number" ? properties["data-metis-stream-born"] : undefined}/>;
  return <span {...props}>{children}</span>;
}
