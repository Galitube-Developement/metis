"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState, type PointerEventHandler } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, placeholder as editorPlaceholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { Eye, Loader2, Paperclip, Pencil } from "lucide-react";
import { noteAttachmentMarkdown, type NoteAttachmentLink } from "@/lib/note-scratchpad";
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
  noteId?: string;
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
  noteId,
}: EditableMarkdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const draftRef = useRef(value);
  const lastExternalValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(true);
  const previewDraft = useDeferredValue(draft);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const uploadPositionRef = useRef<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fileDrag, setFileDrag] = useState(false);

  const uploadFiles = async (files: File[]) => {
    if (!noteId || !files.length) return;
    if (uploadingRef.current) {
      setUploadError("Wait for the current upload, then add these files again.");
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    setUploadError("");
    // Track the insertion point through edits made while the upload is running.
    const view = viewRef.current;
    uploadPositionRef.current = preview ? view?.state.doc.length ?? draftRef.current.length : view?.state.selection.main.head ?? 0;
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/attachments`, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not upload files.");
      const markdown = noteAttachmentMarkdown(body.attachments as NoteAttachmentLink[]);
      const current = viewRef.current;
      if (!current) return;
      // Keep all current text, including edits made during upload.
      const position = uploadPositionRef.current ?? current.state.doc.length;
      uploadPositionRef.current = null;
      const insert = "\n\n" + markdown + "\n\n";
      current.dispatch({ changes: { from: position, insert }, selection: { anchor: position + insert.length } });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not upload files.");
    } finally {
      uploadPositionRef.current = null;
      uploadingRef.current = false;
      setUploading(false);
    }
  };
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
          if (update.docChanged && uploadPositionRef.current !== null) {
            uploadPositionRef.current = update.changes.mapPos(uploadPositionRef.current, 1);
          }
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
      tabIndex={noteId ? 0 : undefined}
      onPasteCapture={(event) => {
        if (!noteId) return;
        const files = Array.from(event.clipboardData.files);
        if (files.length) {
          event.preventDefault();
          event.stopPropagation();
          void uploadFiles(files);
        } else if (preview && event.clipboardData.getData("text/plain")) {
          event.preventDefault();
          event.stopPropagation();
          commit(draftRef.current + (draftRef.current ? "\n\n" : "") + event.clipboardData.getData("text/plain"));
        }
      }}
      onDragOverCapture={(event) => {
        if (!noteId || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        setFileDrag(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDrag(false);
      }}
      onDropCapture={(event) => {
        if (!noteId || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        setFileDrag(false);
        void uploadFiles(Array.from(event.dataTransfer.files));
      }}
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
        title={preview ? "Edit Markdown" : "Preview Markdown"}
        onClick={() => {
          setPreview((current) => !current);
          if (preview) requestAnimationFrame(() => {
            viewRef.current?.requestMeasure();
            viewRef.current?.focus();
          });
        }}
      >
        {preview ? <Pencil className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
      {noteId && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void uploadFiles(Array.from(event.currentTarget.files || []));
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            data-editor-control
            className="absolute bottom-2 right-2 z-10 rounded-md bg-background/90 p-1.5 text-foreground shadow-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
            aria-label={uploading ? "Uploading files" : "Attach images or files"}
            title="Attach images or files · up to 10 files, 50 MB each"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </button>
          {uploading && <div role="status" className="absolute bottom-2 left-2 rounded bg-background px-2 py-1 text-xs text-foreground">Uploading…</div>}
          {uploadError && <div role="alert" className="absolute inset-x-2 bottom-10 z-20 rounded bg-background p-2 text-xs text-destructive">{uploadError}</div>}
          {fileDrag && <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-current bg-background/90 p-3 text-sm text-foreground">Drop images or files here</div>}
        </>
      )}
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
