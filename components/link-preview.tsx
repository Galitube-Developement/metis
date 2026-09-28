"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { positionLinkPreview } from "@/lib/link-preview-position";

type LinkPreviewProps = {
  href: string;
  children: ReactNode;
};

type Preview = {
  title?: string;
  description?: string;
  favicon?: string;
  image?: string;
};

export function LinkPreview({ href, children }: LinkPreviewProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    const updatePosition = () => {
      const position = positionLinkPreview(
        anchor.getBoundingClientRect(),
        tooltip.getBoundingClientRect(),
        window.innerWidth,
        window.innerHeight,
      );
      tooltip.style.left = `${position.left}px`;
      tooltip.style.top = `${position.top}px`;
      tooltip.style.visibility = "visible";
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(tooltip);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
    };
  }, [href, loading, open, preview]);

  function show() {
    setOpen(true);
    if (preview || loading || timerRef.current !== null) return;
    timerRef.current = window.setTimeout(async () => {
      timerRef.current = null;
      setLoading(true);
      try {
        const response = await fetch(`/api/link-preview?url=${encodeURIComponent(href)}`, {
          cache: "force-cache",
        });
        if (response.ok) setPreview((await response.json()) as Preview);
      } catch {
        // Keep the link usable when preview metadata is unavailable.
      } finally {
        setLoading(false);
      }
    }, 220);
  }

  function hide() {
    setOpen(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  return (
    <span ref={anchorRef} className="inline" onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show} onBlurCapture={hide}>
      {children}
      {open && typeof document !== "undefined" ? createPortal(
        <span
          ref={tooltipRef}
          role="tooltip"
          style={{ visibility: "hidden", zIndex: 2147483647 }}
          className="pointer-events-none fixed block w-72 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border/70 bg-popover p-3 text-left text-popover-foreground shadow-xl"
        >
          {loading ? (
            <span className="text-xs text-muted-foreground">Loading link…</span>
          ) : (
            <span className="flex gap-2.5">
              {preview?.favicon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.favicon} alt="" className="mt-0.5 size-4 shrink-0 rounded-sm" />
              ) : null}
              <span className="min-w-0">
                {preview?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.image} alt="" className="mb-2 h-20 w-full rounded-md object-cover" />
                ) : null}
                <span className="block truncate text-xs font-medium">
                  {preview?.title || href}
                </span>
                {preview?.description ? (
                  <span className="mt-1 block line-clamp-3 text-[11px] leading-4 text-muted-foreground">
                    {preview.description}
                  </span>
                ) : (
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">{href}</span>
                )}
              </span>
            </span>
          )}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
