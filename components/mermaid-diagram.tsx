"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Code2, Fullscreen, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { fitMermaidSvg, isMermaidErrorSvg, prepareMermaidSource } from "@/lib/mermaid";

type View = { x: number; y: number; zoom: number };

export function MermaidDiagram({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const reactId = useId().replace(/:/g, "");
  const [mode, setMode] = useState<"interface" | "code">("interface");
  const [fullscreen, setFullscreen] = useState(false);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 1 });
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          fontFamily: "inherit",
          suppressErrorRendering: true,
          flowchart: { useMaxWidth: true, htmlLabels: false, wrappingWidth: 280 },
        });
        const source = prepareMermaidSource(code);
        const id = `mermaid-${reactId}-${Math.abs(hashCode(source))}`;
        const result = await mermaid.render(id, source);
        if (!cancelled) {
          if (!result.svg || isMermaidErrorSvg(result.svg)) {
            setSvg("");
            setError("This flowchart could not be rendered. Switch to Code to edit it.");
          } else {
            setSvg(fitMermaidSvg(result.svg));
            setError("");
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setSvg("");
          setError(cause instanceof Error ? cause.message : "Could not render diagram.");
        }
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const zoomAt = useCallback((event: { clientX: number; clientY: number; deltaY: number }) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    const anchorX = event.clientX - bounds.left;
    const anchorY = event.clientY - bounds.top;
    setView((current) => {
      const nextZoom = Math.min(3, Math.max(0.2, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      const contentX = (anchorX - current.x) / current.zoom;
      const contentY = (anchorY - current.y) / current.zoom;
      return { zoom: nextZoom, x: anchorX - contentX * nextZoom, y: anchorY - contentY * nextZoom };
    });
  }, []);

  const toolbar = (
    <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border/50 bg-background/90 p-0.5 text-[11px] backdrop-blur">
      <button
        type="button"
        className={cn("rounded px-1.5 py-0.5", mode === "code" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
        onClick={() => setMode("code")}
      >
        Code
      </button>
      <button
        type="button"
        className={cn("rounded px-1.5 py-0.5", mode === "interface" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
        onClick={() => setMode("interface")}
      >
        Interface
      </button>
      <button
        type="button"
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        aria-label={fullscreen ? "Exit fullscreen" : "Open flowchart fullscreen"}
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        onClick={() => setFullscreen((current) => !current)}
      >
        {fullscreen ? <Minimize2 className="size-3.5" /> : <Fullscreen className="size-3.5" />}
      </button>
    </div>
  );

  const diagram = mode === "code" ? (
    <pre className="markdown-code-block overflow-auto p-3 text-xs" data-mermaid-source={code}>
      <div className="mb-1.5 text-[10px] font-sans uppercase tracking-wide text-muted-foreground/70">
        {language || "mermaid"}
      </div>
      <code>{code}</code>
    </pre>
  ) : error ? (
    <div className="px-3 py-2 pr-28 text-xs text-muted-foreground" data-mermaid-source={code}>
      {error}
    </div>
  ) : (
    <div
      className="mermaid-diagram overflow-x-auto p-3 pr-28"
      data-mermaid-source={code}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );

  const card = (
    <div className="group relative my-2 max-w-full overflow-hidden rounded-lg border border-border/40 bg-muted/10" data-editor-control="mermaid">
      {toolbar}
      {diagram}
    </div>
  );

  if (!fullscreen) return card;

  const overlay = (
    <div className="fixed inset-0 z-[80] bg-background/80 p-[1%]">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border/40 px-2 py-1.5">
          <button type="button" className={cn("rounded px-1.5 py-0.5 text-[11px]", mode === "code" ? "bg-muted" : "text-muted-foreground")} onClick={() => setMode("code")}>
            <Code2 className="mr-1 inline size-3" />Code
          </button>
          <button type="button" className={cn("rounded px-1.5 py-0.5 text-[11px]", mode === "interface" ? "bg-muted" : "text-muted-foreground")} onClick={() => setMode("interface")}>
            Interface
          </button>
          <button type="button" className="rounded p-1 text-muted-foreground" aria-label="Zoom out" onClick={() => setView((current) => ({ ...current, zoom: Math.max(0.2, current.zoom - 0.1) }))}>
            <ZoomOut className="size-3.5" />
          </button>
          <button type="button" className="rounded p-1 text-muted-foreground" aria-label="Zoom in" onClick={() => setView((current) => ({ ...current, zoom: Math.min(3, current.zoom + 0.1) }))}>
            <ZoomIn className="size-3.5" />
          </button>
          <button type="button" className="rounded p-1 text-muted-foreground" aria-label="Exit fullscreen" onClick={() => setFullscreen(false)}>
            <Minimize2 className="size-3.5" />
          </button>
        </div>
        {mode === "code" ? (
          <pre className="min-h-0 flex-1 overflow-auto p-4 text-xs" data-mermaid-source={code}><code>{code}</code></pre>
        ) : (
          <div
            ref={surfaceRef}
            className="relative min-h-0 flex-1 touch-none overflow-hidden"
            style={{
              backgroundColor: "var(--background)",
              backgroundImage: "radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--muted-foreground) 24%, transparent) 1px, transparent 1.2px)",
              backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
              backgroundPosition: `${view.x}px ${view.y}px`,
            }}
            onWheel={(event) => {
              event.preventDefault();
              if (event.ctrlKey || event.metaKey || event.deltaY) zoomAt(event);
            }}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget && !(event.target as HTMLElement).closest("svg")) return;
              setDragging({ x: event.clientX, y: event.clientY });
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!dragging) return;
              const dx = event.clientX - dragging.x;
              const dy = event.clientY - dragging.y;
              setDragging({ x: event.clientX, y: event.clientY });
              setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
            }}
            onPointerUp={() => setDragging(null)}
          >
            <div
              className="absolute origin-top-left"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
              dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
            />
            {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {card}
      {typeof document !== "undefined" ? createPortal(overlay, document.body) : overlay}
    </>
  );
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}
