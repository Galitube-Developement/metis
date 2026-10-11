"use client";

import { useState, type HTMLAttributes } from "react";
import { appendStreamingText, initialStreamingText } from "@/lib/streaming-text";

export function StreamingText({ text }: { text: string }) {
  const [state, setState] = useState(() => initialStreamingText(text, Date.now()));
  const next = appendStreamingText(state, text, Date.now());
  if (next !== state) setState(next);
  return <>{next.prefix}{next.segments.map(segment => <span key={segment.id} className="stream-token-fade">{segment.text}</span>)}</>;
}

// A stable component reference keeps the animated tail mounted between deltas.
export function StreamingSpan({ node, children, ...props }: HTMLAttributes<HTMLSpanElement> & {
  node?: { properties?: Record<string, unknown> };
}) {
  if (node?.properties?.["data-metis-stream-text"] && typeof children === "string") return <StreamingText text={children}/>;
  return <span {...props}>{children}</span>;
}
