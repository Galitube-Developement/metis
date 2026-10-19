"use client";

import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { positionLinkPreview } from "@/lib/link-preview-position";

let activePreview: { id: string; dismiss: () => void } | null = null;

/** One hover/focus lifecycle, portal, placement and animation for every link preview. */
export function HoverPreview({ children, content }: { children: ReactNode; content: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const clearTimer = () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => () => { clearTimer(); if (activePreview?.id === id) activePreview = null; }, [id]);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tooltip.current) return;
    const node = tooltip.current;
    const update = () => {
      if (!anchor.current) return;
      const position = positionLinkPreview(anchor.current.getBoundingClientRect(), { width: node.offsetWidth, height: node.offsetHeight, left: 0, top: 0, bottom: 0 }, innerWidth, innerHeight);
      node.style.left = position.left + "px";
      node.style.top = position.top + "px";
      node.dataset.side = position.side;
      node.style.visibility = "visible";
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [open]);
  const hide = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    if (activePreview?.id === id) activePreview = null;
    setOpen(false);
  }, [id]);
  const show = () => {
    if (!open && timer.current === null) timer.current = setTimeout(() => {
      timer.current = null; activePreview?.dismiss(); activePreview = { id, dismiss: hide }; setOpen(true);
    }, 180);
  };
  const trigger = open && isValidElement<{ "aria-describedby"?: string }>(children)
    ? cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ") })
    : children;
  return <span ref={anchor} className="inline" onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide(); }}
    onClickCapture={hide}
    onKeyDown={event => { if (event.key === "Escape") hide(); }}>
    {trigger}
    {open ? createPortal(<div ref={tooltip} id={id} role="tooltip" data-hover-preview
      style={{ visibility: "hidden", zIndex: 2147483647 }}
      className="hover-preview pointer-events-none fixed w-72 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border/70 bg-popover p-3 text-left text-popover-foreground shadow-xl">
      {content}
    </div>, document.body) : null}
  </span>;
}
