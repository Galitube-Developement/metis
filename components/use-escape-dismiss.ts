"use client";

import { useEffect } from "react";
import { subscribeToWindowEvents } from "@/lib/browser-events";

/** Fullscreen embeds share the same keyboard lifecycle. React state setters are stable. */
export function useEscapeDismiss(active: boolean, setActive: (active: boolean) => void) {
  useEffect(() => {
    if (!active) return;
    return subscribeToWindowEvents(["keydown"], (event) => {
      if ("key" in event && event.key === "Escape") setActive(false);
    });
  }, [active, setActive]);
}
