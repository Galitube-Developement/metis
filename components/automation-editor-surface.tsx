"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { GripHorizontal, RotateCcw } from "lucide-react";

/** Move only the editor surface, never rerender the model pickers on pointer movement. */
export function AutomationEditorSurface({ floating, children }: { floating: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useRef({ x: 0, y: 0 });
  const gesture = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  function move(x: number, y: number) {
    const panel = ref.current;
    const parent = panel?.closest(".automations-split-view");
    if (!panel || !parent || window.matchMedia("(max-width: 900px)").matches) return;
    const bounds = parent.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const baseLeft = rect.left - position.current.x;
    const baseTop = rect.top - position.current.y;
    position.current = {
      x: Math.min(bounds.right - rect.width - 12 - baseLeft, Math.max(bounds.left + 12 - baseLeft, x)),
      y: Math.min(bounds.bottom - rect.height - 12 - baseTop, Math.max(bounds.top + 12 - baseTop, y)),
    };
    panel.style.translate = `${position.current.x}px ${position.current.y}px`;
  }

  useEffect(() => {
    if (!floating) return;
    function fit() {
      if (window.matchMedia("(max-width: 900px)").matches) {
        position.current = { x: 0, y: 0 };
        if (ref.current) ref.current.style.translate = "none";
      } else move(position.current.x, position.current.y);
    }
    const observer = new ResizeObserver(fit);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [floating]);

  return (
    <div ref={ref} className={`automation-detail-content${floating ? " automation-editor-floating" : ""}`}>
      {floating ? <div className="automation-editor-dragbar">
        <button type="button" className="automation-editor-drag-handle" aria-label="Move automation editor" title="Drag to move · arrow keys to reposition"
          onPointerDown={(event) => {
            if (event.button !== 0 || window.matchMedia("(max-width: 900px)").matches) return;
            gesture.current = { x: event.clientX, y: event.clientY, left: position.current.x, top: position.current.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = gesture.current;
            if (start) move(start.left + event.clientX - start.x, start.top + event.clientY - start.y);
          }}
          onPointerUp={() => { gesture.current = null; }}
          onPointerCancel={() => { gesture.current = null; }}
          onLostPointerCapture={() => { gesture.current = null; }}
          onKeyDown={(event) => {
            const offsets: Record<string, readonly [number, number]> = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
            const delta = offsets[event.key];
            if (delta) { event.preventDefault(); move(position.current.x + delta[0], position.current.y + delta[1]); }
            if (event.key === "Home") { event.preventDefault(); move(0, 0); }
          }}>
          <GripHorizontal aria-hidden="true" /><span>Drag to move</span>
        </button>
        <button type="button" aria-label="Reset editor position" title="Reset position" onClick={() => move(0, 0)}><RotateCcw aria-hidden="true" /></button>
      </div> : null}
      {children}
    </div>
  );
}
