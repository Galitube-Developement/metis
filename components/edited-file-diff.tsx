"use client";

import { useEffect, useMemo, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { EditedFile } from "@/lib/edited-files";
import type { ToolPart } from "@/lib/store";
import { loadEditSnapshot, snapshotHunks, toolsForEditedFile, type EditSnapshot, type EditedFileDiffRequest } from "@/lib/edited-file-diff";

export type EditedFilesDiffProps = Omit<EditedFileDiffRequest, "file">;

export function SnapshotDiff({ snapshot }: { snapshot: EditSnapshot }) {
  const result = useMemo(() => { try { return { hunks: snapshotHunks(snapshot) }; } catch (error) { return { error: error instanceof Error ? error.message : "Diff preview unavailable." }; } }, [snapshot]);
  const [visibleLines, setVisibleLines] = useState(500);
  if (result.error) return <p role="alert" className="px-2 py-3 text-muted-foreground">{result.error}</p>;
  const hunks = result.hunks || [];
  const totalLines = hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
  let remaining = visibleLines;
  const shownHunks = hunks.flatMap(hunk => { const lines = hunk.lines.slice(0, remaining); remaining = Math.max(0, remaining - lines.length); return lines.length ? [{ ...hunk, lines }] : []; });
  if (!hunks.length) return <p className="px-2 py-3 text-muted-foreground">No line changes in this snapshot.</p>;
  return <><div role="region" aria-label="Inline diff, old and new line numbers" tabIndex={0} className="max-h-80 max-w-full overflow-auto font-mono text-[11px] leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <table className="w-full border-collapse text-left">
      <thead className="sr-only"><tr><th>Old line</th><th>New line</th><th>Change</th><th>Content</th></tr></thead>
      <tbody>{shownHunks.map((hunk, index) => {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        return <HunkRows key={index} heading={`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`} rows={hunk.lines.map(line => {
          const marker = line[0];
          const old = marker === " " || marker === "-" ? oldLine++ : undefined;
          const next = marker === " " || marker === "+" ? newLine++ : undefined;
          return { line, old, next };
        })} />;
      })}</tbody>
    </table>
  </div>{totalLines > visibleLines ? <button type="button" className="min-h-10 px-2 text-xs underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setVisibleLines(count => count + 500)}>Show more lines ({Math.min(visibleLines, totalLines)} of {totalLines})</button> : null}</>;
}

function HunkRows({ heading, rows }: { heading: string; rows: { line: string; old?: number; next?: number }[] }) {
  return <><tr><td colSpan={4} className="bg-muted/40 px-2 py-1 text-muted-foreground">{heading}</td></tr>{rows.map(({ line, old, next }, index) => {
    const added = line.startsWith("+");
    const removed = line.startsWith("-");
    return <tr key={index} data-diff-kind={added ? "added" : removed ? "removed" : "context"} className={added ? "bg-green-500/10 text-green-800 dark:text-green-300" : removed ? "bg-destructive/10 text-destructive" : "text-muted-foreground"}>
      <td className="w-8 select-none px-1 text-right align-top tabular-nums">{old}</td>
      <td className="w-8 select-none px-1 text-right align-top tabular-nums">{next}</td>
      <td className="w-5 px-1 align-top"><span className="sr-only">{added ? "Added" : removed ? "Removed" : "Context"}</span><span aria-hidden="true">{line[0]}</span></td>
      <td className="whitespace-pre px-2">{line.slice(1) || " "}</td>
    </tr>;
  })}</>;
}

function EditDiff({ tool, chatId, messageId, editorLanguage }: EditedFilesDiffProps & { tool: ToolPart; editorLanguage?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ status: "loading" | "ready" | "missing" | "error"; snapshot?: EditSnapshot }>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    loadEditSnapshot(tool, { chatId, messageId }, controller.signal).then(snapshot => {
      if (!controller.signal.aborted) setState(snapshot ? { status: "ready", snapshot } : { status: "missing" });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ status: "error" });
    });
    return () => controller.abort();
  }, [tool, chatId, messageId, attempt]);
  if (state.snapshot) {
    if (editorLanguage === undefined) return <SnapshotDiff snapshot={state.snapshot} />;
    if (state.snapshot.before.length + state.snapshot.after.length > 2_000_000) return <p role="status" className="p-4 text-xs text-muted-foreground">This diff exceeds the 2 MB preview limit. Open the original file to continue.</p>;
    return <DiffEditor height="100%" language={editorLanguage} theme="vs-dark" original={state.snapshot.before} modified={state.snapshot.after}
      options={{ readOnly: true, originalEditable: false, originalAriaLabel: "File before this edit", modifiedAriaLabel: "File after this edit", automaticLayout: true, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: true, renderSideBySideInlineBreakpoint: 640, minimap: { enabled: false }, wordWrap: "on", scrollBeyondLastLine: false, padding: { top: 12 } }}
      loading={<p role="status" className="p-4 text-xs text-muted-foreground">Loading diff editor…</p>} />;
  }
  return <div className="px-2 py-3 text-xs text-muted-foreground" role={state.status === "error" ? "alert" : "status"}>
    {state.status === "loading" ? "Loading saved diff…" : state.status === "missing" ? "Historical snapshots unavailable for this edit." : "Could not load saved diff."}
    {state.status !== "loading" && <button type="button" className="ml-2 min-h-9 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
  </div>;
}

export function EditedFileEditorDiff({ file, tools, chatId, messageId, language }: EditedFileDiffRequest & { language: string }) {
  const edits = useMemo(() => toolsForEditedFile(file, tools), [file, tools]);
  const [index, setIndex] = useState(0);
  const tool = edits[index];
  return <div data-editor-file-diff className="flex h-full min-h-0 flex-col">
    <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-1 text-xs text-muted-foreground">
      <span>Before → After</span>
      {edits.length > 1 ? <select aria-label="Edit version" className="h-11 max-w-full rounded-md border border-border bg-background px-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={index} onChange={event => setIndex(Number(event.target.value))}>
        {edits.map((edit, i) => <option key={edit.id} value={i}>Edit {i + 1} of {edits.length}</option>)}
      </select> : null}
    </div>
    <div className="min-h-0 flex-1 overflow-hidden">
      {tool ? <EditDiff key={`${chatId}:${messageId}:${tool.id}`} tool={tool} chatId={chatId} messageId={messageId} editorLanguage={language} /> : <p role="status" className="p-4 text-xs text-muted-foreground">Historical snapshots unavailable for this file.</p>}
    </div>
  </div>;
}

export function EditedFileDiff({ file, tools, chatId, messageId }: EditedFilesDiffProps & { file: EditedFile }) {
  const edits = toolsForEditedFile(file, tools);
  return <div className="min-w-0 max-w-full" data-edited-file-diff>
    {!edits.length ? <p role="status" className="px-2 py-3 text-muted-foreground">Historical snapshots unavailable for this file.</p> : edits.map((tool, index) => <section key={tool.id + ":" + index} aria-label={`Edit ${index + 1} of ${edits.length}`}>
      <p className="px-2 py-1 text-[11px] text-muted-foreground">Edit {index + 1} of {edits.length}</p>
      <EditDiff tool={tool} chatId={chatId} messageId={messageId} />
    </section>)}
  </div>;
}
