"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { workspaceFileDirectory, type WorkspaceFileLocation, type WorkspaceFileRequest } from "@/lib/workspace-file-link";
import { fileEntryNameError, parentFileDirectory, parseFileListing, type FileEntry } from "@/lib/file-editor";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronRight, Download, File, FilePlus2, Folder, FolderPlus, Fullscreen, LoaderCircle, Minimize2, MoreHorizontal, PanelLeft, Pencil, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { FileExplorerSearch } from "@/components/file-explorer-search";
import { useFileSync } from "@/lib/use-file-sync";
import { subscribeVisiblePolling } from "@/lib/visible-polling";
import { FileSyncError, requestFileSnapshot } from "@/lib/file-sync-client";
import { FileEditorPreview } from "@/components/file-editor-preview";
import { filePreviewKind, isBinaryFilePreview } from "@/lib/file-editor-preview";
import { applyFileSyncContent, resolveFileHighlight } from "@/lib/file-editor-highlights";

type RemoteFileEditorProps = {
  cwd: string;
  onCwdChange: (cwd: string) => void;
  fileRequest?: WorkspaceFileRequest | null;
};

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    bash: "shell", css: "css", html: "html", java: "java", js: "javascript", json: "json",
    jsx: "javascript", md: "markdown", mjs: "javascript", py: "python", sh: "shell", sql: "sql",
    ts: "typescript", tsx: "typescript", xml: "xml", yaml: "yaml", yml: "yaml",
  };
  return (extension && languages[extension]) || "plaintext";
}

export function RemoteFileEditor({ cwd, onCwdChange, fileRequest }: RemoteFileEditorProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [fileView, setFileView] = useState<"code" | "preview">("code");
  const [fileTextError, setFileTextError] = useState("");
  const previewKind = filePreviewKind(selectedPath);
  const canEditFile = !isBinaryFilePreview(previewKind) && !fileTextError;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [directoryInput, setDirectoryInput] = useState(cwd);
  const [directorySyncError, setDirectorySyncError] = useState("");
  const [filter, setFilter] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  const [entryDialogMode, setEntryDialogMode] = useState<"create-file" | "create-folder" | "rename" | null>(null);
  const [entryDialogName, setEntryDialogName] = useState("");
  const [entryDialogError, setEntryDialogError] = useState("");
  const pendingActionRef = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const loadedDirectoryRef = useRef<string | null>(null);
  const loadVersionRef = useRef(0);
  const handledFileRequestRef = useRef<number | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [fileLocation, setFileLocation] = useState<WorkspaceFileLocation | null>(null);
  const fileLocationRef = useRef<WorkspaceFileLocation | null>(null);
  fileLocationRef.current = fileLocation;
  const decorationRef = useRef<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]> | null>(null);
  const diffListenerRef = useRef<{ dispose(): void } | null>(null);
  const [highlightMessage, setHighlightMessage] = useState("");
  const [resolveDialog, setResolveDialog] = useState<"disk" | "editor" | null>(null);
  const applyDiskContent = useCallback((text: string) => { if (editorRef.current) applyFileSyncContent(editorRef.current,text); }, []);
  const { content, savedContent, conflict, reviewing, setReviewing, syncError, syncMessage, setContent, loadSnapshot, syncNow, saveCurrent, useDisk } = useFileSync(selectedPath, loading || saving || mutating, applyDiskContent);
  useEffect(() => () => { diffListenerRef.current?.dispose(); }, []);
  const dirty = Boolean(selectedPath) && canEditFile && content !== savedContent;
  useEffect(() => {
    if (fileView === "preview") { editorRef.current = null; decorationRef.current = null; diffListenerRef.current?.dispose(); }
  }, [fileView]);
  const busy = loading || saving || mutating;
  const directoryStateRef = useRef({ cwd, busy });
  directoryStateRef.current = { cwd, busy };
  const visibleEntries = entries;
  const entryDialogTitle = entryDialogMode === "rename" ? "Rename entry" : entryDialogMode === "create-file" ? "New file" : "New folder";

  const revealLocation = useCallback((location: WorkspaceFileLocation | null) => {
    const editor = editorRef.current;
    if (!editor || !location) return;
    const lineNumber = Math.min(location.line || 1, editor.getModel()?.getLineCount() || 1);
    const column = Math.min(location.column || 1, editor.getModel()?.getLineMaxColumn(lineNumber) || 1);
    const model = editor.getModel();
    const resolved = model ? (location.changes || []).map(change => ({ change, range: resolveFileHighlight(model,change) })).filter(item => item.range) : [];
    decorationRef.current?.clear();
    if (resolved.length) {
      decorationRef.current = editor.createDecorationsCollection(resolved.map(({change,range}) => ({
        range: range!, options: { isWholeLine: true, className: change.kind === "deleted" ? "metis-file-removed-line" : "metis-file-changed-line", linesDecorationsClassName: change.kind === "deleted" ? "metis-file-removed-gutter" : "metis-file-changed-gutter" },
      })));
      editor.setSelection(resolved[0].range!); editor.revealRangeInCenter(resolved[0].range!);
    } else {
      if (location.endLine && model && !location.changes?.length) editor.setSelection({startLineNumber:lineNumber,startColumn:column,endLineNumber:Math.max(lineNumber,Math.min(location.endLine,model.getLineCount())),endColumn:location.endColumn || model.getLineMaxColumn(Math.min(location.endLine,model.getLineCount()))});
      else editor.setPosition({ lineNumber, column });
      editor.revealLineInCenter(lineNumber);
    }
    setHighlightMessage(location.changes?.length && !resolved.length ? "This file changed since the recorded edit; the changed text could not be located." : "");
    editor.focus();
  }, []);

  useEffect(() => {
    if (fileLocation?.path === selectedPath) revealLocation(fileLocation);
  }, [fileLocation, selectedPath, revealLocation]);
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model || !fileLocation?.changes?.length || fileLocation.path !== selectedPath) return;
    const ranges = fileLocation.changes.map(change => ({change,range:resolveFileHighlight(model,change)})).filter(item => item.range);
    decorationRef.current?.set(ranges.map(({change,range})=>({range:range!,options:{isWholeLine:true,className:change.kind==="deleted"?"metis-file-removed-line":"metis-file-changed-line",linesDecorationsClassName:change.kind==="deleted"?"metis-file-removed-gutter":"metis-file-changed-gutter"}})));
    setHighlightMessage(ranges.length ? "" : "This file changed since the recorded edit; the changed text could not be located.");
  }, [content,fileLocation,selectedPath]);
  useEffect(() => { setDirectoryInput(cwd); }, [cwd]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const request = useCallback(async (body: Record<string, unknown>, signal?: AbortSignal) => {
    const response = await fetch("/api/remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    let data: { error?: string; output?: string; content?: string; path?: string; newPath?: string };
    try { data = await response.json(); }
    catch { throw new Error("The file server did not return a complete response. Try again."); }
    if (!response.ok) throw new Error(data.error || "File action failed. Try again.");
    if (data.output && /\[exit code: [1-9]\d*\]/.test(data.output)) throw new Error(data.output.trim());
    return data;
  }, []);

  useEffect(() => subscribeVisiblePolling(async signal => {
    if (directoryStateRef.current.busy || loadedDirectoryRef.current !== cwd) return;
    const version = loadVersionRef.current;
    try {
      const data = await request({ action: "list", path: cwd, cwd }, signal);
      if (signal.aborted || version !== loadVersionRef.current || directoryStateRef.current.cwd !== cwd || directoryStateRef.current.busy) return;
      const next = parseFileListing(data.output || "", cwd);
      setEntries(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      setDirectorySyncError("");
    } catch (cause) {
      if (!signal.aborted && version === loadVersionRef.current && directoryStateRef.current.cwd === cwd) {
        setDirectorySyncError(cause instanceof Error ? cause.message : "Files could not be synced.");
      }
    }
  }), [cwd, request]);

  async function loadDirectory(nextPath = cwd, preserveFile = false) {
    const version = ++loadVersionRef.current;
    setLoading(true); setError("");
    try {
      const data = await request({ action: "list", path: nextPath, cwd });
      if (version !== loadVersionRef.current) return false;
      loadedDirectoryRef.current = nextPath;
      setDirectorySyncError("");
      setEntries(parseFileListing(data.output || "", nextPath));
      onCwdChange(nextPath); setDirectoryInput(nextPath);
      setSearchRevision(value => value + 1);
      if (!preserveFile) {
        setSelectedPath(""); setFileTextError(""); setFileView("code"); loadSnapshot("", { content: "", revision: "" }); setFileLocation(null); setFilter(""); setExplorerOpen(true);
      }
      return true;
    } catch (cause) {
      if (version === loadVersionRef.current) setError(cause instanceof Error ? cause.message : "Directory could not be loaded.");
      return false;
    } finally { if (version === loadVersionRef.current) setLoading(false); }
  }

  useEffect(() => {
    if (loadedDirectoryRef.current !== cwd) void loadDirectory(cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  function runAfterUnsavedCheck(action: () => void) {
    if (!dirty) { action(); return; }
    pendingActionRef.current = action; setUnsavedDialogOpen(true);
  }

  async function readFile(location: WorkspaceFileLocation, loadParent = false) {
    const version = ++loadVersionRef.current;
    setError(""); setLoading(true);
    try {
      const parent = workspaceFileDirectory(location.path);
      const kind = filePreviewKind(location.path);
      let textError = "";
      const [file, listing] = await Promise.all([
        isBinaryFilePreview(kind) ? Promise.resolve(null) : requestFileSnapshot({ action: "snapshot", path: location.path }).catch(cause => {
          if (cause instanceof FileSyncError && [413, 415].includes(cause.status)) { textError = cause.message; return null; }
          throw cause;
        }),
        loadParent ? request({ action: "list", path: parent, cwd }) : Promise.resolve(null),
      ]);
      if (version !== loadVersionRef.current) return;
      if (listing) {
        loadedDirectoryRef.current = parent;
        setDirectorySyncError("");
        setEntries(parseFileListing(listing.output || "", parent));
        onCwdChange(parent); setDirectoryInput(parent); setFilter("");
      }
      setSelectedPath(location.path); setFileTextError(textError);
      setFileView(kind && (!file || (!location.line && !location.changes?.length)) ? "preview" : "code");
      loadSnapshot(location.path, file || { content: "", revision: "" }); setFileLocation({ ...location });
      if ((containerRef.current?.clientWidth || 0) < 640) setExplorerOpen(false);
    } catch (cause) {
      if (version === loadVersionRef.current) setError(cause instanceof Error ? cause.message : "File could not be read.");
    } finally { if (version === loadVersionRef.current) setLoading(false); }
  }

  useEffect(() => {
    if (!fileRequest || handledFileRequestRef.current === fileRequest.id) return;
    handledFileRequestRef.current = fileRequest.id;
    if (fileRequest.path === selectedPath) { setExplorerOpen(false); if (canEditFile) setFileView("code"); setFileLocation({ ...fileRequest }); return; }
    runAfterUnsavedCheck(() => void readFile(fileRequest, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileRequest]);

  function openEntry(entry: FileEntry) {
    if (entry.path === selectedPath) { if ((containerRef.current?.clientWidth || 0) < 640) setExplorerOpen(false); return; }
    runAfterUnsavedCheck(() => { if (entry.directory) void loadDirectory(entry.path); else void readFile({ path: entry.path }); });
  }

  function openSearchResult(location: WorkspaceFileLocation) {
    if (location.path === selectedPath) {
      setFileLocation({ ...location }); if (canEditFile) setFileView("code");
      if ((containerRef.current?.clientWidth || 0) < 640) setExplorerOpen(false);
      return;
    }
    runAfterUnsavedCheck(() => void readFile(location));
  }

  async function save() {
    if (!selectedPath || !canEditFile || saving) return false;
    setSaving(true); setError("");
    try {
      const saved = await saveCurrent();
      if (saved) { setSearchRevision(value => value + 1); toast.success("File saved"); }
      return saved;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "File could not be saved."); return false; }
    finally { setSaving(false); }
  }

  async function handleUnsavedSave() {
    const action = pendingActionRef.current;
    if (await save()) { pendingActionRef.current = null; setUnsavedDialogOpen(false); action?.(); }
  }
  function discardUnsavedChanges() {
    const action = pendingActionRef.current;
    pendingActionRef.current = null; setUnsavedDialogOpen(false); action?.();
  }
  function cancelUnsavedChanges() { pendingActionRef.current = null; setUnsavedDialogOpen(false); }

  function openEntryDialog(mode: "create-file" | "create-folder" | "rename", path = "") {
    const open = () => {
      setRenameTarget(path); setEntryDialogName(mode === "rename" ? path.split("/").pop() || "" : "");
      setEntryDialogError(""); setEntryDialogMode(mode);
    };
    if (mode === "create-file" || (mode === "rename" && path === selectedPath)) runAfterUnsavedCheck(open);
    else open();
  }
  function closeEntryDialog() { if (mutating) return; setEntryDialogMode(null); setEntryDialogName(""); setEntryDialogError(""); }

  async function submitEntryDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mode = entryDialogMode, name = entryDialogName.trim();
    if (!mode || mutating) return;
    const invalid = fileEntryNameError(name);
    if (invalid) { setEntryDialogError(invalid); return; }
    const path = mode === "rename" ? renameTarget : `${cwd.replace(/\/$/, "")}/${name}`;
    const newPath = mode === "rename" ? `${workspaceFileDirectory(path).replace(/\/$/, "")}/${name}` : path;
    if (mode === "rename" && path === newPath) { closeEntryDialog(); return; }
    if (entries.some(entry => entry.path === newPath)) { setEntryDialogError("A file or folder with this name already exists."); return; }
    setMutating(true); setEntryDialogError("");
    try {
      await request({ action: mode === "rename" ? "rename" : mode === "create-file" ? "create" : "mkdir", path, newPath, cwd });
      setEntryDialogMode(null); setEntryDialogName("");
      const reopen = mode === "create-file" || (mode === "rename" && path === selectedPath);
      if (reopen) await readFile({ path: newPath }, true);
      else await loadDirectory(cwd, true);
      toast.success(mode === "rename" ? "Renamed" : mode === "create-file" ? "File created" : "Folder created");
    } catch (cause) { setEntryDialogError(cause instanceof Error ? cause.message : "Entry could not be created."); }
    finally { setMutating(false); }
  }

  function deleteEntry(path: string) {
    const action = async () => {
      setMutating(true); setError("");
      try {
        await request({ action: "delete", path, cwd });
        if (path === selectedPath) { setSelectedPath(""); loadSnapshot("", { content: "", revision: "" }); setFileLocation(null); setExplorerOpen(true); }
        await loadDirectory(cwd, true); toast.success("Deleted");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Entry could not be deleted."); }
      finally { setMutating(false); }
    };
    if (path === selectedPath) runAfterUnsavedCheck(() => void action()); else void action();
  }

  const stopDragging = useCallback(() => {
    dragStartRef.current = null; setDragging(false);
    document.body.style.removeProperty("cursor"); document.body.style.removeProperty("user-select");
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const start = dragStartRef.current;
      if (start) setExplorerWidth(Math.min(420, Math.max(160, Math.round(start.width + event.clientX - start.pointerX))));
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stopDragging); window.addEventListener("pointercancel", stopDragging);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stopDragging); window.removeEventListener("pointercancel", stopDragging); };
  }, [dragging, stopDragging]);
  useEffect(() => stopDragging, [stopDragging]);
  function startDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault(); dragStartRef.current = { pointerX: event.clientX, width: explorerWidth }; setDragging(true);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  }
  function onResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); setExplorerWidth(width => Math.min(420, Math.max(160, width + (event.key === "ArrowLeft" ? -16 : 16))));
    }
  }

  const editor = (
    <div ref={containerRef} data-file-editor data-explorer-open={explorerOpen} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (dirty && !busy) void save(); } }} style={{ containerType: "inline-size", containerName: "files" }}
      className={fullscreen ? "fixed inset-0 z-50 flex min-h-0 flex-col bg-background p-3 sm:inset-3 sm:rounded-lg sm:border sm:border-border sm:p-4" : "flex min-h-0 min-w-0 flex-1 flex-col"}>
      <style>{`@container files (max-width:639px){.file-explorer{width:100%!important;border-right:0}.file-explorer-resize{display:none!important}[data-explorer-open=true] .file-editor-pane{display:none}.file-toolbar-label{display:none}.file-toolbar-button{width:36px;padding:0}.file-navigation-toggle{display:inline-flex!important}}.metis-file-changed-line{background:color-mix(in srgb,var(--foreground) 9%,transparent)}.metis-file-removed-line{background:color-mix(in srgb,var(--destructive) 12%,transparent)}.metis-file-changed-gutter{border-left:2px solid var(--foreground)}.metis-file-removed-gutter{border-left:2px solid var(--destructive)}`}</style>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 pb-3">
        <div className="flex min-w-0 items-center gap-1">
          <Button size="sm" variant="secondary" className="h-9" disabled={busy} onClick={() => openEntryDialog("create-file")}><FilePlus2 className="size-4" />New file</Button>
          <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => openEntryDialog("create-folder")}><FolderPlus className="size-4" />New folder</Button>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={() => setFullscreen(open => !open)} aria-label={fullscreen ? "Exit fullscreen" : "Open file fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
          {fullscreen ? <Minimize2 className="size-4" /> : <Fullscreen className="size-4" />}
        </Button>
      </div>
      <form className="flex shrink-0 items-center gap-1 py-2" onSubmit={event => { event.preventDefault(); const path = directoryInput.trim(); if (path) runAfterUnsavedCheck(() => void loadDirectory(path)); }}>
        <Button type="button" size="icon-sm" variant="ghost" disabled={busy || cwd === "/"} onClick={() => runAfterUnsavedCheck(() => void loadDirectory(parentFileDirectory(cwd)))} aria-label="Parent folder" title="Parent folder"><ArrowUp className="size-4" /></Button>
        <Input value={directoryInput} onChange={event => setDirectoryInput(event.target.value)} aria-label="Remote directory" className="h-9 min-w-0 flex-1 font-mono text-xs" onKeyDown={event => { if (event.key === "Escape") setDirectoryInput(cwd); }} />
        <Button type="submit" size="icon-sm" variant="ghost" disabled={busy || !directoryInput.trim()} aria-label="Open directory" title="Open directory"><ChevronRight className="size-4" /></Button>
        <Button type="button" size="icon-sm" variant="ghost" disabled={busy} onClick={() => void loadDirectory(cwd, true)} aria-label="Refresh files" title="Refresh files"><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
      </form>
      {error || directorySyncError ? <div role="alert" className="mb-2 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive"><span className="min-w-0 flex-1 break-words">{error || directorySyncError}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => void loadDirectory(cwd, true)}>Retry</Button></div> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden border-t border-border/50">
        <aside hidden={!explorerOpen} className="file-explorer flex min-h-0 shrink-0 flex-col border-r border-border/50" style={{ width: explorerWidth }} aria-label="File explorer">
          <FileExplorerSearch directory={cwd} query={filter} onQueryChange={setFilter} onOpen={openSearchResult} disabled={busy} revision={searchRevision} />
          {!filter.trim() ? <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" aria-busy={loading}>
            {visibleEntries.map(entry => (
              <div key={entry.path} className={`group flex items-center rounded-md ${entry.path === selectedPath ? "bg-muted" : "hover:bg-muted/50"}`}>
                <button type="button" disabled={busy} onClick={() => openEntry(entry)} aria-current={entry.path === selectedPath ? "page" : undefined} title={entry.name} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {entry.directory ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" disabled={busy} className="shrink-0" aria-label={`Actions for ${entry.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => openEntryDialog("rename", entry.path)}><Pencil />Rename</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(entry.path)}><Trash2 />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            {loading && entries.length === 0 ? <p role="status" className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading files…</p> : null}
            {!loading && !error && visibleEntries.length === 0 ? <div className="px-3 py-8 text-center text-xs text-muted-foreground"><p>{filter ? "No matching files." : "This folder is empty."}</p><p className="mt-2">{filter ? "Try another name." : "Use New file or New folder to get started."}</p></div> : null}
          </div> : null}
          {selectedPath ? <Button size="sm" variant="ghost" className="file-navigation-toggle m-2 hidden" onClick={() => setExplorerOpen(false)}>Back to editor</Button> : null}
        </aside>
        <div hidden={!explorerOpen} role="separator" aria-orientation="vertical" aria-label="Resize file explorer" aria-valuemin={160} aria-valuemax={420} aria-valuenow={explorerWidth} tabIndex={0} onPointerDown={startDragging} onKeyDown={onResizeKeyDown} className="file-explorer-resize w-2 shrink-0 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <section className="file-editor-pane flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border/50 px-2">
            <Button size="icon-sm" variant="ghost" aria-label={explorerOpen ? "Hide file explorer" : "Show file explorer"} title="Toggle file explorer" aria-expanded={explorerOpen} onClick={() => setExplorerOpen(open => !open)}><PanelLeft className="size-4" /></Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium" title={selectedPath}>{selectedPath.split("/").pop() || "Editor"}</p>
              {selectedPath ? <p role="status" className="text-[11px] text-muted-foreground">{!canEditFile ? "Preview" : saving ? "Saving…" : conflict ? "Conflict on disk" : dirty ? "Unsaved changes" : "Synced with disk"}</p> : null}
            </div>
            {selectedPath && previewKind && canEditFile ? <div role="group" aria-label="File view" className="flex shrink-0 items-center gap-0.5">
              <Button size="sm" variant={fileView === "code" ? "secondary" : "ghost"} aria-pressed={fileView === "code"} onClick={() => setFileView("code")}>Code</Button>
              <Button size="sm" variant={fileView === "preview" ? "secondary" : "ghost"} aria-pressed={fileView === "preview"} onClick={() => setFileView("preview")}>Preview</Button>
            </div> : null}
            <Button asChild size="icon-sm" variant="ghost" aria-label="Download file" title={dirty ? "Download saved file (save changes first to include them)" : "Download file"}>
              <a href={selectedPath && !busy ? "/api/remote/download?path=" + encodeURIComponent(selectedPath) : undefined} download={selectedPath.split("/").pop()} aria-disabled={!selectedPath || busy} tabIndex={!selectedPath || busy ? -1 : undefined} className={!selectedPath || busy ? "pointer-events-none opacity-50" : undefined}><Download className="size-4" /></a>
            </Button>
            <Button size="sm" className="file-toolbar-button" disabled={!selectedPath || !canEditFile || busy || !dirty || Boolean(conflict) || Boolean(syncError)} onClick={() => void save()} aria-label="Save file" title="Save (Ctrl/⌘ S)">
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}<span className="file-toolbar-label">Save</span>
            </Button>
          </div>
          {conflict ? <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1">Changes overlap with the disk version. Your edits are preserved.</span>
            <Button size="sm" variant="outline" onClick={() => setReviewing(value => !value)}>{reviewing ? "Back to editor" : "Review changes"}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setResolveDialog("disk")}>Use disk version</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setResolveDialog("editor")}>Save edited version</Button>
          </div> : null}
          {syncError ? <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-xs text-destructive"><span className="min-w-0 flex-1">{syncError}</span><Button size="sm" variant="ghost" onClick={() => void syncNow()}>Retry sync</Button></div> : null}
          {syncMessage && !conflict ? <p role="status" className="shrink-0 px-3 py-1 text-[11px] text-muted-foreground">{syncMessage}</p> : null}
          {highlightMessage ? <p role="status" className="shrink-0 px-3 py-1 text-[11px] text-muted-foreground">{highlightMessage}</p> : null}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {selectedPath && fileTextError ? <div role="alert" className="p-5 text-sm text-muted-foreground"><p>{fileTextError}</p><p className="mt-2">Download the original file to open it.</p></div> : selectedPath && fileView === "preview" && previewKind ? <FileEditorPreview key={selectedPath} path={selectedPath} kind={previewKind} content={content} /> : selectedPath && reviewing && conflict ? <DiffEditor height="100%" language={languageForPath(selectedPath)} theme="vs-dark" original={conflict.content} modified={content} onMount={instance => {
              diffListenerRef.current?.dispose(); editorRef.current = instance.getModifiedEditor();
              diffListenerRef.current = instance.getModifiedEditor().onDidChangeModelContent(() => setContent(instance.getModifiedEditor().getModel()?.getValue(undefined,true) || ""));
            }} options={{ originalEditable:false,readOnly:busy,renderSideBySide:(containerRef.current?.clientWidth || 0)>=640,automaticLayout:true,minimap:{enabled:false},wordWrap:"on" }} /> : selectedPath ? <Editor onMount={editor => { diffListenerRef.current?.dispose(); editorRef.current = editor; revealLocation(fileLocationRef.current); }}
              height="100%" path={selectedPath} language={languageForPath(selectedPath)} theme="vs-dark" value={content} onChange={value => setContent(editorRef.current?.getModel()?.getValue(undefined,true) ?? value ?? "")}
              options={{ readOnly: busy, automaticLayout: true, detectIndentation: false, insertSpaces: false, minimap: { enabled: false }, lineNumbers: "on", padding: { top: 12 }, scrollBeyondLastLine: false, tabSize: 2, wordWrap: "on" }}
              loading={<div className="p-3 text-xs text-muted-foreground">Loading editor…</div>} />
              : <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-6 text-center"><File className="size-6 text-muted-foreground" /><p className="text-sm font-medium">Open a file to edit</p><p className="max-w-60 text-xs leading-relaxed text-muted-foreground">Choose a file from the explorer or create a new one.</p><Button size="sm" variant="outline" disabled={busy} onClick={() => openEntryDialog("create-file")}><FilePlus2 className="size-4" />New file</Button></div>}
            {loading && selectedPath ? <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-xs"><LoaderCircle className="size-4 animate-spin" />Loading…</div> : null}
          </div>
        </section>
      </div>
      {selectedPath ? <p data-open-file={selectedPath} className="shrink-0 truncate border-t border-border/50 pt-2 text-[11px] text-muted-foreground" title={selectedPath}>{selectedPath}</p> : null}
      <Dialog open={entryDialogMode !== null} onOpenChange={open => { if (!open) closeEntryDialog(); }}>
        <DialogContent className="sm:max-w-sm"><form onSubmit={submitEntryDialog} className="space-y-4">
          <DialogHeader><DialogTitle>{entryDialogTitle}</DialogTitle><DialogDescription>{entryDialogMode === "rename" ? "Choose a new name for this file or folder." : "Create it in the current folder."}<span className="mt-2 block break-all font-mono text-[11px]">{entryDialogMode === "rename" ? renameTarget : cwd}</span></DialogDescription></DialogHeader>
          <label className="block space-y-2 text-xs"><span>Name</span><Input autoFocus value={entryDialogName} onChange={event => { setEntryDialogName(event.target.value); setEntryDialogError(""); }} aria-label="Entry name" aria-invalid={Boolean(entryDialogError)} aria-describedby={entryDialogError ? "entry-name-error" : undefined} placeholder={entryDialogMode === "create-file" ? "example.yml" : entryDialogMode === "create-folder" ? "New folder" : "New name"} disabled={mutating} /></label>
          {entryDialogError ? <p id="entry-name-error" role="alert" className="break-words text-xs text-destructive">{entryDialogError}</p> : null}
          <DialogFooter><Button type="button" variant="ghost" disabled={mutating} onClick={closeEntryDialog}>Cancel</Button><Button type="submit" disabled={!entryDialogName.trim() || mutating}>{mutating ? <LoaderCircle className="size-4 animate-spin" /> : null}{entryDialogMode === "rename" ? "Rename" : "Create"}</Button></DialogFooter>
        </form></DialogContent>
      </Dialog>
      <Dialog open={unsavedDialogOpen} onOpenChange={open => { if (!open && !saving) cancelUnsavedChanges(); }}>
        <DialogContent><DialogHeader><DialogTitle>Unsaved changes</DialogTitle><DialogDescription>Save your changes before continuing?</DialogDescription></DialogHeader><DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={cancelUnsavedChanges}>Cancel</Button>
          <Button type="button" variant="outline" disabled={saving} onClick={discardUnsavedChanges}>Discard changes</Button>
          <Button type="button" onClick={() => void handleUnsavedSave()} disabled={saving}>Save and continue</Button>
        </DialogFooter></DialogContent>
      </Dialog>
      <ConfirmDialog open={Boolean(resolveDialog)} onOpenChange={open => { if (!open) setResolveDialog(null); }} title={resolveDialog === "disk" ? "Use the disk version?" : "Save your edited version?"} description={resolveDialog === "disk" ? "This replaces your unsaved editor contents with the disk version." : "Review all changes first. Your edited version will replace the disk version only if it has not changed again."} confirmLabel={resolveDialog === "disk" ? "Use disk version" : "Save edited version"} onConfirm={() => {
        const choice = resolveDialog; setResolveDialog(null);
        if (choice === "disk") useDisk();
        else if (conflict) { setSaving(true); void saveCurrent(conflict).then(saved => { if (saved) { setSearchRevision(value => value + 1); toast.success("File saved"); } }).finally(() => setSaving(false)); }
      }} />
      <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open) setDeleteTarget(""); }} title="Delete entry?" description={`Delete “${deleteTarget.split("/").pop()}”? Folders and their contents will be removed. This cannot be undone.`} confirmLabel="Delete" onConfirm={() => { const path = deleteTarget; setDeleteTarget(""); deleteEntry(path); }} />
    </div>
  );
  return fullscreen && typeof document !== "undefined" ? createPortal(editor, document.body) : editor;
}
