"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Editor from "@monaco-editor/react";
import { createPortal } from "react-dom";
import { ChevronRight, File, Folder, Fullscreen, LoaderCircle, Minimize2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type RemoteEntry = { name: string; directory: boolean; path: string };

type RemoteFileEditorProps = {
  cwd: string;
  onCwdChange: (cwd: string) => void;
};

function parseListing(output: string, cwd: string): RemoteEntry[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const match = line.match(/^([d-])[^\s]*\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+(.+)$/);
      if (!match) return null;
      const name = match[2].replace(/ -> .*$/, "");
      if (name === "." || name === "..") return null;
      return { name, directory: match[1] === "d", path: `${cwd.replace(/\/$/, "")}/${name}` };
    })
    .filter((entry): entry is RemoteEntry => Boolean(entry))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    bash: "shell", css: "css", html: "html", java: "java", js: "javascript", json: "json",
    jsx: "javascript", md: "markdown", mjs: "javascript", py: "python", sh: "shell", sql: "sql",
    ts: "typescript", tsx: "typescript", xml: "xml", yaml: "yaml", yml: "yaml",
  };
  return (extension && languages[extension]) || "plaintext";
}

export function RemoteFileEditor({ cwd, onCwdChange }: RemoteFileEditorProps) {
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedEntryPath, setSelectedEntryPath] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [dragging, setDragging] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState("");
  const [entryDialogMode, setEntryDialogMode] = useState<"create-folder" | "rename" | null>(null);
  const [entryDialogName, setEntryDialogName] = useState("");
  const pendingActionRef = useRef<(() => void) | null>(null);
  const dragStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const dirty = Boolean(selectedPath) && content !== savedContent;

  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/remote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { error?: string; output?: string; content?: string; path?: string; newPath?: string };
    if (!response.ok) throw new Error(data.error || "Remote file action failed");
    return data;
  }

  async function loadDirectory(nextPath = cwd) {
    setLoading(true);
    setError("");
    try {
      const data = await request({ action: "list", path: nextPath, cwd });
      setEntries(parseListing(data.output || "", nextPath));
      onCwdChange(nextPath);
      setSelectedPath("");
      setSelectedEntryPath("");
      setContent("");
      setSavedContent("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Directory could not be loaded");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDirectory(cwd);
    // The editor should refresh when the shared remote cwd changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  function runAfterUnsavedCheck(action: () => void) {
    if (!dirty) {
      action();
      return;
    }
    pendingActionRef.current = action;
    setUnsavedDialogOpen(true);
  }

  async function openEntry(entry: RemoteEntry) {
    setError("");
    const action = async () => {
      setSelectedEntryPath(entry.path);
      if (entry.directory) {
        await loadDirectory(entry.path);
        setSelectedEntryPath(entry.path);
        return;
      }
      try {
        const data = await request({ action: "read", path: entry.path, cwd });
        setSelectedPath(entry.path);
        setContent(data.content || "");
        setSavedContent(data.content || "");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "File could not be read");
      }
    };
    runAfterUnsavedCheck(() => void action());
  }

  async function save() {
    if (!selectedPath) return false;
    setSaving(true);
    try {
      await request({ action: "write", path: selectedPath, cwd, content });
      setSavedContent(content);
      toast.success("File saved");
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "File could not be saved");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleUnsavedSave() {
    const action = pendingActionRef.current;
    if (await save()) {
      pendingActionRef.current = null;
      setUnsavedDialogOpen(false);
      action?.();
    }
  }

  function discardUnsavedChanges() {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setUnsavedDialogOpen(false);
    action?.();
  }

  function cancelUnsavedChanges() {
    pendingActionRef.current = null;
    setUnsavedDialogOpen(false);
  }

  async function createFile() {
    const name = newName.trim();
    if (!name) return;
    const action = async () => {
      try {
        await request({ action: "write", path: `${cwd.replace(/\/$/, "")}/${name}`, cwd, content: "" });
        setNewName("");
        await loadDirectory(cwd);
        toast.success("File created");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "File could not be created");
      }
    };
    runAfterUnsavedCheck(() => void action());
  }

  function openCreateFolderDialog() {
    setEntryDialogName("");
    setEntryDialogMode("create-folder");
  }

  function openRenameDialog() {
    if (!selectedEntryPath) return;
    setEntryDialogName(selectedEntryPath.split("/").pop() || "");
    setEntryDialogMode("rename");
  }

  function closeEntryDialog() {
    setEntryDialogMode(null);
    setEntryDialogName("");
  }

  function submitEntryDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mode = entryDialogMode;
    const name = entryDialogName.trim();
    if (!mode || !name) return;

    if (mode === "create-folder") {
      closeEntryDialog();
      createFolder(name);
      return;
    }

    const path = selectedEntryPath;
    const currentName = path.split("/").pop() || "";
    if (!path || name === currentName) {
      closeEntryDialog();
      return;
    }
    closeEntryDialog();
    renameSelected(path, currentName, name);
  }

  function createFolder(name: string) {
    const action = async () => {
      try {
        await request({ action: "mkdir", path: `${cwd.replace(/\/$/, "")}/${name}`, cwd });
        await loadDirectory(cwd);
        toast.success("Ordner erstellt");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Folder could not be created");
      }
    };
    runAfterUnsavedCheck(() => void action());
  }

  function renameSelected(path: string, currentName: string, name: string) {
    const action = async () => {
      try {
        await request({ action: "rename", path, newPath: `${path.slice(0, -currentName.length)}${name}`, cwd });
        setSelectedEntryPath("");
        setSelectedPath("");
        setContent("");
        setSavedContent("");
        await loadDirectory(cwd);
        toast.success("Umbenannt");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Entry could not be renamed");
      }
    };
    runAfterUnsavedCheck(() => void action());
  }

  function deleteSelected() {
    if (!selectedEntryPath) return;
    const action = async () => {
      try {
        await request({ action: "delete", path: selectedEntryPath, cwd });
        setSelectedPath("");
        setSelectedEntryPath("");
        setContent("");
        setSavedContent("");
        await loadDirectory(cwd);
        toast.success("File deleted");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "File could not be deleted");
      }
    };
    runAfterUnsavedCheck(() => void action());
  }

  const stopDragging = useCallback(() => {
    dragStartRef.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      setExplorerWidth(Math.min(420, Math.max(160, Math.round(start.width + event.clientX - start.pointerX))));
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging, stopDragging]);

  function startDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    dragStartRef.current = { pointerX: event.clientX, width: explorerWidth };
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") setExplorerWidth((width) => Math.max(160, width - 16));
    if (event.key === "ArrowRight") setExplorerWidth((width) => Math.min(420, width + 16));
  }

  const editor = (
    <div className={fullscreen ? "fixed inset-[1%] z-50 flex min-h-0 flex-col gap-3 rounded-2xl border border-border bg-background p-4 shadow-2xl ring-1 ring-foreground/10 sm:p-6" : "flex min-h-0 flex-1 flex-col gap-2"}>
      <div className="flex items-center gap-2">
        <Input value={cwd} onChange={(event) => onCwdChange(event.target.value)} aria-label="Remote directory" className="h-8 min-w-0 flex-1 font-mono text-xs" />
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => runAfterUnsavedCheck(() => void loadDirectory(cwd))} aria-label="Refresh files">
          <LoaderCircle className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
        {fullscreen ? (
          <div className="flex items-center gap-1">
            <Button type="button" size="icon-sm" variant="secondary" disabled={!selectedPath || saving} onClick={() => void save()} aria-label="Save file" title="Save file">
              {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            </Button>
            <Button type="button" size="icon-sm" variant="secondary" onClick={() => runAfterUnsavedCheck(() => setFullscreen(false))} aria-label="Exit fullscreen" title="Exit fullscreen">
              <Minimize2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 gap-0">
        <div className="min-h-0 shrink-0 overflow-y-auto rounded-md border border-border/40 p-1" style={{ width: `${explorerWidth}px` }}>
          {entries.map((entry) => (
            <button key={entry.path} type="button" onClick={() => void openEntry(entry)} className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/50 ${entry.path === selectedEntryPath ? "bg-muted" : ""}`}>
              {entry.directory ? <Folder className="size-3.5 text-primary" /> : <File className="size-3.5 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.directory ? <ChevronRight className="size-3 text-muted-foreground" /> : null}
            </button>
          ))}
          {!loading && entries.length === 0 ? <p className="p-2 text-xs text-muted-foreground">Directory is empty.</p> : null}
        </div>
        <div role="separator" aria-orientation="vertical" aria-label="Resize file explorer" aria-valuemin={160} aria-valuemax={420} aria-valuenow={explorerWidth} tabIndex={0} onPointerDown={startDragging} onKeyDown={onResizeKeyDown} className="group flex w-3 shrink-0 cursor-col-resize items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={`h-full w-px bg-border/50 transition-colors group-hover:bg-primary/60 ${dragging ? "bg-primary" : ""}`} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1">
            <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="New file…" className="h-8 min-w-0 flex-1 text-xs" />
            <Button type="button" size="icon-sm" variant="ghost" disabled={!newName.trim()} onClick={() => void createFile()} aria-label="Create file"><Plus className="size-3.5" /></Button>
            <Button type="button" size="icon-sm" variant="ghost" onClick={openCreateFolderDialog} aria-label="Create folder"><Folder className="size-3.5" /></Button>
            <Button type="button" size="icon-sm" variant="ghost" disabled={!selectedEntryPath} onClick={openRenameDialog} aria-label="Rename entry"><Pencil className="size-3.5" /></Button>
            <Button type="button" size="icon-sm" variant="ghost" disabled={!selectedEntryPath} onClick={() => setDeleteTarget(selectedEntryPath)} aria-label="Delete entry"><Trash2 className="size-3.5" /></Button>
            {!fullscreen ? <Button type="button" size="sm" variant="outline" disabled={!selectedPath} onClick={() => setFullscreen(true)} aria-label="Open file fullscreen" title="Open file fullscreen"><Fullscreen className="size-3.5" />Fullscreen</Button> : null}
            {!fullscreen ? <Button type="button" size="icon-sm" disabled={!selectedPath || saving} onClick={() => void save()} aria-label="Save file" title="Save file">{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}</Button> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/40">
            <Editor height="100%" path={selectedPath || "untitled"} language={languageForPath(selectedPath)} theme="vs-dark" value={content} onChange={(value) => setContent(value ?? "")} options={{ automaticLayout: true, detectIndentation: false, insertSpaces: false, minimap: { enabled: false }, lineNumbers: "on", padding: { top: 8 }, scrollBeyondLastLine: false, tabSize: 2, wordWrap: "on" }} loading={<div className="p-3 text-xs text-muted-foreground">Loading editor…</div>} />
          </div>
        </div>
      </div>
      {selectedPath ? <p className="truncate text-[11px] text-muted-foreground">{dirty ? "Unsaved changes · " : ""}{selectedPath}</p> : null}
      {error ? <p className="whitespace-pre-wrap text-xs text-destructive">{error}</p> : null}
      <Dialog open={entryDialogMode !== null} onOpenChange={(open) => { if (!open) closeEntryDialog(); }}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submitEntryDialog} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{entryDialogMode === "rename" ? "Rename entry" : "Create folder"}</DialogTitle>
              <DialogDescription>
                {entryDialogMode === "rename" ? "Enter a new name for the selected file or folder." : "Enter a name for the new folder."}
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={entryDialogName}
              onChange={(event) => setEntryDialogName(event.target.value)}
              aria-label={entryDialogMode === "rename" ? "New entry name" : "Folder name"}
              placeholder={entryDialogMode === "rename" ? "New name" : "Folder name"}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={closeEntryDialog}>Cancel</Button>
              <Button type="submit" disabled={!entryDialogName.trim()}>
                {entryDialogMode === "rename" ? "Rename" : "Create folder"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={unsavedDialogOpen} onOpenChange={(open) => { if (!open) cancelUnsavedChanges(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>This file has changes that have not been saved. What would you like to do before leaving it?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={cancelUnsavedChanges}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={discardUnsavedChanges}>Discard changes</Button>
            <Button type="button" onClick={() => void handleUnsavedSave()} disabled={saving}>Save and continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget("")}
        title="Delete entry?"
        description={`Are you sure you want to delete “${deleteTarget}”? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={deleteSelected}
      />
    </div>
  );

  return fullscreen && typeof document !== "undefined" ? createPortal(editor, document.body) : editor;
}
