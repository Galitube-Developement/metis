"use client";

import { useEffect, useRef, useState } from "react";
import { File, LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceSearchResult, type WorkspaceSearchResult } from "@/lib/workspace-search-result";
import type { WorkspaceFileLocation } from "@/lib/workspace-file-link";
import { subscribeVisiblePolling } from "@/lib/visible-polling";

type Props = {
  directory: string;
  query: string;
  onQueryChange: (value: string) => void;
  onOpen: (location: WorkspaceFileLocation) => void;
  disabled: boolean;
  revision: number;
};

export function FileExplorerSearch({ directory, query, onQueryChange, onOpen, disabled, revision }: Props) {
  const [mode, setMode] = useState<"files" | "content">("files");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WorkspaceSearchResult | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const active = Boolean(query.trim());
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const searchKey = JSON.stringify([directory, query, mode, caseSensitive, regex, revision, retry]);
  const [resultKey, setResultKey] = useState("");
  const current = resultKey === searchKey ? result : null;
  const pending = active && (loading || resultKey !== searchKey);

  useEffect(() => {
    const version = ++generation.current, controller = new AbortController();
    setError("");
    if (!active) { setLoading(false); setResult(null); setResultKey(""); return; }
    setLoading(true);
    let running = false, initialized = false;
    const search = async (signal: AbortSignal, background = false) => {
      if (running || (background && (!initialized || disabledRef.current))) return;
      running = true;
      try {
        const response = await fetch("/api/remote", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ action: "search", path: directory, cwd: directory, query, searchMode: mode, caseSensitive, regex }),
        });
        const data = await response.json().catch(() => { throw new Error("Search returned an incomplete response. Try again."); });
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Search failed. Try again.");
        const parsed = workspaceSearchResult(data.search);
        if (!parsed) throw new Error("Search returned an invalid response. Try again.");
        if (version !== generation.current || signal.aborted) return;
        setResult(previous => JSON.stringify(previous) === JSON.stringify(parsed) ? previous : parsed);
        setResultKey(searchKey); setError("");
      } catch (cause) {
        if (version !== generation.current || signal.aborted) return;
        if (!background) { setResult(null); setResultKey(searchKey); }
        setError(cause instanceof Error ? cause.message : "Search failed.");
      } finally {
        running = false; initialized = true;
        if (version === generation.current && !signal.aborted) setLoading(false);
      }
    };
    const timer = window.setTimeout(() => void search(controller.signal), 300);
    const stopPolling = subscribeVisiblePolling(signal => search(signal, true));
    return () => { window.clearTimeout(timer); controller.abort(); stopPolling(); };
  }, [active, directory, query, mode, caseSensitive, regex, revision, retry, searchKey]);

  const groups = new Map<string, NonNullable<WorkspaceSearchResult>["entries"]>();
  for (const entry of current?.entries || []) {
    const group = groups.get(entry.absolutePath) || []; group.push(entry); groups.set(entry.absolutePath, group);
  }
  return (
    <>
      <div className="shrink-0 space-y-2 border-b border-border/40 px-2 py-3">
        <div className="flex gap-1" role="group" aria-label="Search mode">
          <Button size="sm" variant={mode === "files" ? "secondary" : "ghost"} className="h-8 flex-1 text-xs" aria-pressed={mode === "files"} onClick={() => setMode("files")}>Files</Button>
          <Button size="sm" variant={mode === "content" ? "secondary" : "ghost"} className="h-8 flex-1 text-xs" aria-pressed={mode === "content"} onClick={() => setMode("content")}>Contents</Button>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-muted/40 px-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input value={query} onChange={event => onQueryChange(event.target.value)} maxLength={500} placeholder={mode === "files" ? "Find files…" : "Search in files…"} aria-label="Filter files" className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none" onKeyDown={event => { if (event.key === "Escape") onQueryChange(""); }} />
          {mode === "content" ? <>
            <Button size="icon-sm" variant={caseSensitive ? "secondary" : "ghost"} aria-label="Match case" title="Match case" aria-pressed={caseSensitive} onClick={() => setCaseSensitive(value => !value)} className="size-7 shrink-0 font-mono text-xs">Aa</Button>
            <Button size="icon-sm" variant={regex ? "secondary" : "ghost"} aria-label="Use regular expression" title="Use regular expression" aria-pressed={regex} onClick={() => setRegex(value => !value)} className="size-7 shrink-0 font-mono text-xs">.*</Button>
          </> : null}
          {active ? <Button size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="Clear search" title="Clear search" onClick={() => onQueryChange("")}><X className="size-3.5" /></Button> : null}
        </div>

        {active ? <p className="truncate text-[11px] text-muted-foreground" title={directory}>In this folder and subfolders</p> : null}
      </div>
      {active ? <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2" aria-busy={pending} data-search-results>
        {pending ? <p role="status" className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Searching…</p> : null}
        {!pending && error ? <div role="alert" className="space-y-2 break-words p-3 text-xs text-destructive"><p>{error}</p><Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>Retry search</Button></div> : null}
        {!pending && current ? <>
          <p role="status" className="px-2 pb-2 text-[11px] text-muted-foreground">{current.entries.length}{current.truncated ? "+" : ""} {mode === "files" ? (current.entries.length === 1 ? "file" : "files") : "matches"}{mode === "content" ? ` · ${groups.size} ${groups.size === 1 ? "file" : "files"}` : ""}</p>
          {current.entries.length === 0 ? <p className="px-2 py-6 text-center text-xs text-muted-foreground">No matches. Try another search.</p> : null}
          {[...groups].map(([path, entries]) => <div key={path} className="mb-2">
            <button type="button" disabled={disabled} onClick={() => onOpen({ path, line: entries[0].line, column: entries[0].column })} title={entries[0].path} className="flex min-h-10 w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <File className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{entries[0].path.split("/").pop()}</span>{entries[0].path.includes("/") ? <span className="block truncate text-[11px] text-muted-foreground">{entries[0].path.slice(0, entries[0].path.lastIndexOf("/"))}</span> : null}</span>
              {mode === "content" ? <span className="shrink-0 text-[11px] text-muted-foreground">{entries.length}</span> : null}
            </button>
            {mode === "content" ? entries.map(entry => <button key={entry.line} type="button" disabled={disabled} onClick={() => onOpen({ path, line: entry.line, column: entry.column })} title={`${entry.path}:${entry.line} — ${entry.text}`} className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md py-2 pl-7 pr-2 text-left font-mono text-[11px] hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="shrink-0 tabular-nums text-muted-foreground">{entry.line}</span><span className="min-w-0 flex-1 truncate">{entry.text}</span>
            </button>) : null}
          </div>)}
          {current.truncated ? <p className="px-2 py-2 text-[11px] text-muted-foreground">Results limited. Narrow your search.</p> : null}
          {current.skipped > 0 ? <p className="px-2 py-2 text-[11px] text-muted-foreground">{current.skipped} unreadable, binary or oversized entries skipped.</p> : null}
        </> : null}
      </div> : null}
    </>
  );
}
