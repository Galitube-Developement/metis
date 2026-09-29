"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState, type PointerEventHandler } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, placeholder as editorPlaceholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { Markdown } from "@/components/markdown";
import { minimalMarkdownChange, replaceEmbeddedSource, toggleMarkdownTask } from "@/lib/markdown-editor";
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

function markdownDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const visible of view.visibleRanges) {
    for (let position = visible.from; position <= visible.to;) {
      const line = view.state.doc.lineAt(position);
      const heading = /^(#{1,6})(?=\s)/.exec(line.text);
      if (heading) {
        ranges.push(Decoration.line({ attributes: { class: "cm-md-heading cm-md-h" + heading[1].length } }).range(line.from));
      }
      if (line.to >= visible.to || line.number === view.state.doc.lines) break;
      position = line.to + 1;
    }
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const className = node.name === "StrongEmphasis" ? "cm-md-strong"
          : node.name === "Emphasis" ? "cm-md-emphasis"
          : node.name === "InlineCode" ? "cm-md-inline-code"
          : node.name === "Link" ? "cm-md-link"
          : ["HeaderMark", "EmphasisMark", "CodeMark", "LinkMark", "ListMark", "QuoteMark", "TaskMarker", "CodeInfo"].includes(node.name) ? "cm-md-syntax"
          : "";
        if (className && node.from < node.to) {
          ranges.push(Decoration.mark({ class: className }).range(node.from, node.to));
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

const markdownStyling = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = markdownDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) this.decorations = markdownDecorations(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

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
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const draftRef = useRef(value);
  const lastExternalValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(false);
  const previewDraft = useDeferredValue(draft);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;
    const state = EditorState.create({
      doc: draftRef.current,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.lineWrapping,
        editorPlaceholder(placeholder || "Write Markdown…"),
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel || "Markdown editor",
          spellcheck: "true",
        }),
        markdownStyling,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || syncingRef.current) return;
          const next = update.state.doc.toString();
          draftRef.current = next;
          lastExternalValueRef.current = next;
          setDraft(next);
          onChangeRef.current(next);
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // The editor instance owns cursor and undo state. External value changes sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value === lastExternalValueRef.current) return;
    lastExternalValueRef.current = value;
    draftRef.current = value;
    setDraft(value);
    const view = viewRef.current;
    if (!view) return;
    const change = minimalMarkdownChange(view.state.doc.toString(), value);
    if (!change) return;
    syncingRef.current = true;
    try {
      view.dispatch({ changes: change });
    } finally {
      syncingRef.current = false;
    }
  }, [value]);

  const commit = useCallback((next: string) => {
    if (next === draftRef.current) return;
    const view = viewRef.current;
    if (view) {
      const change = minimalMarkdownChange(view.state.doc.toString(), next);
      if (change) view.dispatch({ changes: change });
      return;
    }
    draftRef.current = next;
    lastExternalValueRef.current = next;
    setDraft(next);
    onChangeRef.current(next);
  }, []);

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
      className={cn("editable-markdown group relative min-h-0 w-full flex-1 overflow-hidden rounded-md", className)}
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
      <button
        type="button"
        className="editable-markdown-toggle"
        aria-label={preview ? "Edit Markdown" : "Preview Markdown"}
        onClick={() => {
          setPreview((current) => !current);
          if (preview) requestAnimationFrame(() => viewRef.current?.focus());
        }}
      >
        {preview ? "Edit" : "Preview"}
      </button>
      <div ref={editorHostRef} className="editable-markdown-editor" hidden={preview} />
      {preview && (
        <div
          data-markdown-preview
          aria-label={ariaLabel ? ariaLabel + " preview" : "Markdown preview"}
          className="editable-markdown-preview"
        >
          {previewDraft ? <Markdown content={previewDraft} interactiveTasks={interactiveTasks} /> : (
            <span className="text-muted-foreground/70">{placeholder || "Nothing to preview yet."}</span>
          )}
        </div>
      )}
    </div>
  );
}
