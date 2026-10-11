"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  AUTOMATION_SIDEBAR_DEFAULT_WIDTH,
  automationSidebarBounds,
  clampAutomationSidebarWidth,
} from "@/lib/automation-sidebar-layout";

const WIDTH_KEY = "ai-chat:automation-sidebar-width";

/** Resize the attached sidebar without rerendering the form on pointer movement. */
export function AutomationSplitView({ creating, children }: { creating: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const requestedWidth = useRef(AUTOMATION_SIDEBAR_DEFAULT_WIDTH);
  const displayedWidth = useRef(AUTOMATION_SIDEBAR_DEFAULT_WIDTH);
  const gesture = useRef<{ x: number; width: number; cursor: string; userSelect: string } | null>(null);

  const paint = useCallback(() => {
    const container = ref.current;
    const handle = handleRef.current;
    if (!container || !handle) return;
    const containerWidth = container.getBoundingClientRect().width;
    const width = clampAutomationSidebarWidth(requestedWidth.current, containerWidth);
    const { min, max } = automationSidebarBounds(containerWidth);
    displayedWidth.current = width;
    container.style.setProperty("--automation-detail-width", `${width}px`);
    handle.setAttribute("aria-valuemin", String(Math.round(min)));
    handle.setAttribute("aria-valuemax", String(Math.round(max)));
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuetext", `${width} pixels`);
  }, []);

  const save = useCallback(() => {
    try { localStorage.setItem(WIDTH_KEY, String(requestedWidth.current)); } catch { /* Storage may be disabled. */ }
  }, []);

  const stop = useCallback(() => {
    const start = gesture.current;
    if (!start) return;
    gesture.current = null;
    document.body.style.cursor = start.cursor;
    document.body.style.userSelect = start.userSelect;
    handleRef.current?.removeAttribute("data-resizing");
    save();
  }, [save]);

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(stored) && stored > 0) requestedWidth.current = stored;
    } catch { /* Keep the default when storage is unavailable. */ }
    paint();
    const observer = new ResizeObserver(() => {
      if (window.matchMedia("(max-width: 900px)").matches) stop();
      paint();
    });
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("blur", stop);
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", stop);
      stop();
    };
  }, [paint, stop]);

  return (
    <div ref={ref} className="automations-split-view" data-slot="automations-split-view" data-creating={creating}>
      {children}
      <div
        ref={handleRef}
        className="automation-sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize automation sidebar"
        aria-valuemin={360}
        aria-valuemax={960}
        aria-valuenow={AUTOMATION_SIDEBAR_DEFAULT_WIDTH}
        tabIndex={0}
        title="Drag to resize · arrow keys to adjust · double-click to reset"
        onPointerDown={(event) => {
          if (event.button !== 0 || window.matchMedia("(max-width: 900px)").matches) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = {
            x: event.clientX, width: displayedWidth.current,
            cursor: document.body.style.cursor, userSelect: document.body.style.userSelect,
          };
          event.currentTarget.setAttribute("data-resizing", "true");
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onPointerMove={(event) => {
          const start = gesture.current;
          if (!start || !ref.current) return;
          requestedWidth.current = clampAutomationSidebarWidth(
            start.width + start.x - event.clientX,
            ref.current.getBoundingClientRect().width,
          );
          paint();
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onDoubleClick={() => {
          requestedWidth.current = AUTOMATION_SIDEBAR_DEFAULT_WIDTH;
          paint();
          save();
        }}
        onKeyDown={(event) => {
          const { min, max } = automationSidebarBounds(ref.current?.getBoundingClientRect().width ?? 0);
          const next = event.key === "ArrowLeft" ? displayedWidth.current + 16
            : event.key === "ArrowRight" ? displayedWidth.current - 16
            : event.key === "Home" ? min : event.key === "End" ? max : undefined;
          if (next === undefined) return;
          event.preventDefault();
          requestedWidth.current = clampAutomationSidebarWidth(next, ref.current?.getBoundingClientRect().width ?? 0);
          paint();
          save();
        }}
      ><span aria-hidden="true" /></div>
    </div>
  );
}
