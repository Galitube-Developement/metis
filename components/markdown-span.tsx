"use client";

import type { ComponentProps } from "react";
import { ChatIcon } from "@/components/chat-icon";
import { StreamingSpan } from "@/components/streaming-text";

// Icons and streaming text share the Markdown span slot; neither may override the other.
export function MarkdownSpan(props: ComponentProps<typeof StreamingSpan> & { "data-metis-icon"?: string; "data-metis-icon-leading"?: boolean }) {
  const name = props["data-metis-icon"];
  return name
    ? <ChatIcon name={name} className={props["data-metis-icon-leading"]
      ? "metis-leading-icon inline-block size-[1.1em] text-current"
      : "mr-1.5 inline-block size-[1.1em] align-[-0.15em] text-current"} />
    : <StreamingSpan {...props} />;
}
