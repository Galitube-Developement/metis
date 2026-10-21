import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

export const UPDATE_LOG_MAX_LINES = 200;
export const UPDATE_LOG_MAX_LINE_CHARS = 2048;
export const UPDATE_LOG_MAX_CHARS = 64 * 1024;
const CHUNK_BYTES = 64 * 1024;

export const updateLogFailure = (text: string) => /unbound variable|^Error:|\bError: |Failed to compile\.|Build failed|ELIFECYCLE.*(?:failed|exit code)|ERR_PNPM_|FATAL ERROR:|heap out of memory|OOMErrorHandler/m.test(text);
export const updateLogSuccess = (text: string) => /Metis AI installed successfully/i.test(text);
const boundedLine = (line: string) => line.length > UPDATE_LOG_MAX_LINE_CHARS
  ? line.slice(0, UPDATE_LOG_MAX_LINE_CHARS) + " … [line truncated]" : line;

class LogTail {
  lines: string[] = [];
  evidence = new Map<string, { line: string; order: number }>();
  count = 0;
  add(raw: string) {
    const line = boundedLine(raw.replace(/\r$/, ""));
    if (!line.trim()) return;
    const kind = /^\[metis-update-job:/.test(line) ? "job" : /^\[metis-update-pid:/.test(line) ? "pid"
      : /^\[metis-update-exit:/.test(line) ? "exit" : updateLogSuccess(line) ? "success" : updateLogFailure(line) ? "failure" : null;
    if (kind) this.evidence.set(kind, { line, order: this.count });
    this.count++;
    this.lines.push(line);
    if (this.lines.length > UPDATE_LOG_MAX_LINES) this.lines.shift();
  }
  snapshot(limit = UPDATE_LOG_MAX_LINES, pending = "") {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(UPDATE_LOG_MAX_LINES, Math.floor(limit))) : UPDATE_LOG_MAX_LINES;
    const tail = [...this.lines, ...(pending.trim() ? [boundedLine(pending)] : [])].slice(-safeLimit);
    const seen = new Set(tail);
    const important = [...this.evidence.values()].sort((a, b) => a.order - b.order).map(row => row.line);
    const header = important.filter(line => /^\[metis-update-job:/.test(line));
    const extra = important.filter(line => !header.includes(line) && !seen.has(line));
    const prefix = [...header, ...extra];
    let budget = UPDATE_LOG_MAX_CHARS - prefix.reduce((sum, line) => sum + line.length + 1, 0);
    const kept: string[] = [];
    for (let i = tail.length - 1; i >= 0; i--) {
      const line = tail[i];
      if (header.includes(line)) continue;
      if (line.length + 1 > budget) break;
      kept.unshift(line); budget -= line.length + 1;
    }
    return [...prefix, ...kept];
  }
}

export function boundInstallerLogLines(lines: readonly unknown[]) {
  const tail = new LogTail();
  for (const line of lines) tail.add(typeof line === "string" ? line : String(line));
  return tail.snapshot();
}

export function createInstallerLogCursor() {
  return { bytes: 0, identity: "", modified: 0, decoder: new StringDecoder("utf8"), pending: "", truncated: false };
}
type Cursor = ReturnType<typeof createInstallerLogCursor>;

/** Decode bounded chunks and cap unterminated lines before StringDecoder can accumulate them. */
export async function streamInstallerLog(file: string, cursor: Cursor, onLine: (line: string) => void, onReset?: () => void) {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
    if (cursor.identity !== identity || info.size < cursor.bytes || (info.size === cursor.bytes && info.mtimeMs !== cursor.modified)) {
      Object.assign(cursor, createInstallerLogCursor(), { identity });
      onReset?.();
    }
    const buffer = Buffer.alloc(CHUNK_BYTES);
    while (cursor.bytes < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, info.size - cursor.bytes), cursor.bytes);
      if (!bytesRead) break;
      cursor.bytes += bytesRead;
      const parts = cursor.decoder.write(buffer.subarray(0, bytesRead)).split("\n");
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index], remaining = Math.max(0, UPDATE_LOG_MAX_LINE_CHARS - cursor.pending.length);
        cursor.pending += part.slice(0, remaining);
        if (part.length > remaining) cursor.truncated = true;
        if (index < parts.length - 1) {
          onLine(cursor.pending + (cursor.truncated ? " … [line truncated]" : ""));
          cursor.pending = ""; cursor.truncated = false;
        }
      }
    }
    cursor.modified = info.mtimeMs;
  } finally { await handle.close(); }
}

type LogIndex = { cursor: Cursor; tail: LogTail; active: boolean; pending?: Promise<void> };
const indexes = new Map<string, LogIndex>();

/** Index once, then consume only appended bytes. Keep bounded evidence for job recovery. */
export async function readBoundedInstallerLog(file: string, limit = 80, jobId?: string): Promise<string[]> {
  const key = JSON.stringify([file, jobId ?? null]);
  let index = indexes.get(key);
  if (!index) {
    if (indexes.size >= 8) indexes.delete(indexes.keys().next().value!);
    index = { cursor: createInstallerLogCursor(), tail: new LogTail(), active: !jobId };
    indexes.set(key, index);
  }
  const state = index;
  try {
    if (!state.pending) state.pending = streamInstallerLog(file, state.cursor, line => {
      const marker = line.match(/^\[metis-update-job:([^\]]+)\]/)?.[1];
      if (marker) {
        state.active = !jobId || marker === jobId;
        if (state.active) state.tail = new LogTail();
      }
      if (state.active) state.tail.add(line);
    }, () => { state.tail = new LogTail(); state.active = !jobId; }).finally(() => { state.pending = undefined; });
    await state.pending;
    return state.tail.snapshot(limit, state.active ? state.cursor.pending : "");
  } catch { return []; }
}

/** Legacy JSON files may already be oversized; never decode those in one allocation. */
export async function readBoundedUpdateJson(file: string, maxBytes: number) {
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size;
    if (size > maxBytes) throw new Error("Update state exceeds the supported size; the installer log remains available.");
    const buffer = Buffer.alloc(Math.min(size + 1, maxBytes + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error("Update state exceeds the supported size.");
    return buffer.subarray(0, offset).toString("utf8");
  } finally { await handle.close(); }
}
