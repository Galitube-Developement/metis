"use client";

import { memo, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AgentCursor } from "@/components/agent-cursor";

export type BrowserPointer = { x: number; y: number; kind: string; ts: number };
export type BrowserAgentPointerHandle = { show: (pointer: BrowserPointer) => void; clear: () => void };

/** Frequent agent motion must not rerender AppShell and its transcript/composer. */
export const BrowserAgentPointer = memo(function BrowserAgentPointer({ ref }: { ref: Ref<BrowserAgentPointerHandle> }) {
  const [pointer, setPointer] = useState<BrowserPointer | null>(null);
  const pending = useRef<BrowserPointer | null>(null);
  const frame = useRef<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    show(next) {
      pending.current = next;
      if (frame.current === null) frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setPointer(pending.current);
      });
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        pending.current = null;
        setPointer(null);
      }, 4000);
    },
    clear() {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      frame.current = null;
      hideTimer.current = null;
      pending.current = null;
      setPointer(null);
    },
  }), []);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
  }, []);

  return pointer ? (
    <span className="metis-browser-agent-cursor" style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }}>
      <AgentCursor kind={pointer.kind} />
    </span>
  ) : null;
});
