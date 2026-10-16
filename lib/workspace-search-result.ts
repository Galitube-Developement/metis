export type WorkspaceSearchEntry = {
  path: string;
  absolutePath: string;
  line?: number;
  column?: number;
  text?: string;
  textTruncated?: boolean;
  context?: Array<{ line: number; text: string }>;
};
export type WorkspaceSearchResult = {
  type: "file_search" | "text_search";
  root: string;
  pattern: string;
  entries: WorkspaceSearchEntry[];
  truncated: boolean;
  limits: string[];
  skipped: number;
};
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function workspaceSearchResult(payload: unknown): WorkspaceSearchResult | undefined {
  function parse(value: unknown, depth: number): WorkspaceSearchResult | undefined {
    if (depth > 6) return;
    if (typeof value === "string") { try { return parse(JSON.parse(value), depth + 1); } catch { return; } }
    const data = record(value);
    if (!data) return;
    if ((data.type === "file_search" || data.type === "text_search") && typeof data.root === "string" && typeof data.pattern === "string") {
      const entries = data.type === "file_search" ? data.files : data.matches;
      if (!Array.isArray(entries) || entries.length > 200 || !entries.every(item => {
        const entry = record(item);
        return entry && typeof entry.path === "string" && typeof entry.absolutePath === "string" &&
          (data.type === "file_search" || Number.isSafeInteger(entry.line) && Number(entry.line) > 0 && typeof entry.text === "string");
      })) return;
      const skipped = record(data.skipped);
      return { type: data.type, root: data.root, pattern: data.pattern,
        entries: entries.map(value => {
          const entry = value as WorkspaceSearchEntry;
          return { path: entry.path, absolutePath: entry.absolutePath, ...(data.type === "text_search" ? {
            line: entry.line, column: Number.isSafeInteger(entry.column) && Number(entry.column) > 0 ? entry.column : undefined,
            text: entry.text, textTruncated: entry.textTruncated === true,
            context: Array.isArray(entry.context) ? entry.context.filter(row => Number.isSafeInteger(row?.line) && row.line > 0 && typeof row.text === "string").slice(0, 6) : undefined,
          } : {}) };
        }),
        truncated: data.truncated === true,
        limits: Array.isArray(data.limits) ? data.limits.filter(item => typeof item === "string").slice(0, 10) : [],
        skipped: Object.values(skipped ?? {}).reduce<number>((sum, count) => sum + (typeof count === "number" && count > 0 && Number.isFinite(count) ? count : 0), 0),
      };
    }
    for (const nested of [data.structuredContent, data.structured_content, data.result, data.data, data.stdout]) {
      const result = parse(nested, depth + 1); if (result) return result;
    }
    if (Array.isArray(data.content)) for (const block of data.content) {
      const result = parse(record(block)?.text, depth + 1); if (result) return result;
    }
  }
  return parse(payload, 0);
}
export function workspaceSearchCount(result: WorkspaceSearchResult) {
  const count = result.entries.length, noun = result.type === "file_search" ? "file" : "match";
  return `${count}${result.truncated ? "+" : ""} ${noun}${count === 1 ? "" : noun === "match" ? "es" : "s"}`;
}
