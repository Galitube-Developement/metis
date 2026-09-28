"use client";

import { useCallback, useEffect, useRef, useState, type PointerEventHandler } from "react";
import { Markdown } from "@/components/markdown";
import { replaceEmbeddedSource, toggleMarkdownTask } from "@/lib/markdown-editor";
import { cn } from "@/lib/utils";

type EditableMarkdownProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  interactiveTasks?: boolean;
};

/**
 * The textarea owns Markdown source. The rendered result is a separate preview,
 * so React never has to reconcile text that contentEditable changed behind it.
 */
export function EditableMarkdown({
  value,
  onChange,
  placeholder,
  className,
  "aria-label": ariaLabel,
  onPointerDown,
  interactiveTasks = false,
}: EditableMarkdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(value);
  const lastExternalValueRef = useRef(value);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (value === lastExternalValueRef.current) return;
    lastExternalValueRef.current = value;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  const commit = useCallback((next: string) => {
    if (next === draftRef.current) return;
    draftRef.current = next;
    lastExternalValueRef.current = next;
    setDraft(next);
    onChange(next);
  }, [onChange]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onEmbedChange = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; source?: string }>).detail;
      const kind = detail?.kind;
      if (kind !== "chart" && kind !== "graph" && kind !== "mermaid") return;
      if (typeof detail.source !== "string") return;
      const boards = Array.from(root.querySelectorAll<HTMLElement>(
        '[data-markdown-preview] [data-editor-control="' + kind + '"]',
      ));
      const index = boards.indexOf(event.target as HTMLElement);
      if (index < 0) return;
      commit(replaceEmbeddedSource(draftRef.current, kind, index, detail.source));
    };
    root.addEventListener("metis:markdown-embed-change", onEmbedChange);
    return () => root.removeEventListener("metis:markdown-embed-change", onEmbedChange);
  }, [commit]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "editable-markdown min-h-0 w-full flex-1 overflow-hidden rounded-md text-[13px] leading-5",
        className,
      )}
      onPointerDown={onPointerDown}
      onChangeCapture={(event) => {
        if (!interactiveTasks) return;
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
        if (target.closest("[data-editor-control]")) return;
        const root = rootRef.current;
        if (!root) return;
        const tasks = Array.from(root.querySelectorAll<HTMLInputElement>(
          '[data-markdown-preview] input[type="checkbox"]',
        )).filter((task) => !task.closest("[data-editor-control]"));
        const index = tasks.indexOf(target);
        if (index >= 0) commit(toggleMarkdownTask(draftRef.current, index, target.checked));
      }}
    >
      <div className="editable-markdown-layout">
        <div className="editable-markdown-source flex min-h-0 flex-col">
          <div className="shrink-0 px-2 py-1 text-[10px] font-medium uppercase tracking-wide opacity-60">Markdown</div>
          <textarea
            value={draft}
            onChange={(event) => commit(event.target.value)}
            aria-label={ariaLabel || "Markdown source"}
            placeholder={placeholder}
            spellCheck
            className="min-h-0 w-full flex-1 resize-none bg-transparent px-2 pb-2 font-mono text-[inherit] leading-[inherit] text-inherit outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
          />
        </div>
        <div className="editable-markdown-preview-pane flex min-h-0 flex-col">
          <div className="shrink-0 px-2 py-1 text-[10px] font-medium uppercase tracking-wide opacity-60">Preview</div>
          <div
            data-markdown-preview
            aria-label={ariaLabel ? ariaLabel + " preview" : "Markdown preview"}
            className="min-h-0 flex-1 overflow-auto px-2 pb-2"
          >
            {draft ? <Markdown content={draft} interactiveTasks={interactiveTasks} /> : (
              <span className="text-muted-foreground/70">{placeholder || "Preview appears here."}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
