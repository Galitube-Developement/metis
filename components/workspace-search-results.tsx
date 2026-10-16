"use client";
import type { WorkspaceSearchResult } from "@/lib/workspace-search-result";
import { workspaceSearchCount } from "@/lib/workspace-search-result";
import { workspaceFileHref } from "@/lib/workspace-file-link";
export function WorkspaceSearchResults({ result }: { result: WorkspaceSearchResult }) {
  return <section aria-label="Search results" className="min-w-0 space-y-2">
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
      <span className="font-medium">{workspaceSearchCount(result)}</span>
      <span className="min-w-0 break-all text-[11px] text-muted-foreground">{result.root}</span>
    </div>
    {!result.entries.length ? <p className="text-muted-foreground">{result.truncated ? "Search stopped before finding a match. Narrow the path or pattern." : "No matches found in this scope."}</p> : <ul className="divide-y divide-border/40">
      {result.entries.map((entry, index) => {
        const location = { path: entry.absolutePath, line: entry.line, column: entry.column };
        const label = entry.path + (entry.line ? ":" + entry.line : "");
        return <li key={entry.path + ":" + entry.line + ":" + index} className="min-w-0 py-2">
          {entry.absolutePath.startsWith("/") ? <a href={workspaceFileHref(location)}
            className="break-all font-mono text-xs text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-ring"
            onClick={event => { event.preventDefault(); window.dispatchEvent(new CustomEvent("ai-chat:open-file", { detail: location })); }}>
            {label}
          </a> : <span className="break-all font-mono text-xs">{label}</span>}
          {entry.text !== undefined ? <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground">
            {[...(entry.context ?? []), { line: entry.line!, text: entry.text }].sort((a,b) => a.line-b.line).map(row =>
              <span key={row.line} className={row.line === entry.line ? "block text-foreground" : "block"}><span className="mr-2 select-none text-muted-foreground/60">{row.line}</span>{row.text}</span>)}
          </pre> : null}
          {entry.textTruncated ? <p className="text-[10px] text-muted-foreground">Line preview shortened. Open the file for the full line.</p> : null}
        </li>;
      })}
    </ul>}
    {result.truncated ? <p role="status" className="text-muted-foreground">Partial results ({result.limits.join(", ") || "limit reached"}). Narrow the path or pattern.</p> : null}
    {result.skipped ? <p className="text-[11px] text-muted-foreground">{result.skipped} file(s) skipped: binary, oversized, unreadable or symlink.</p> : null}
  </section>;
}
