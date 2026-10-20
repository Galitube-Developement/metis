/** Explicit workspace links and legacy absolute POSIX file links. Authorization stays in /api/remote. */
export type WorkspaceFileLocation = { path: string; line?: number; column?: number; endLine?: number; endColumn?: number; changes?: import("./file-change-ranges").FileChangeRange[] };
export type WorkspaceFileRequest = WorkspaceFileLocation & { id: number; diff?: import("./edited-file-diff").EditedFileDiffRequest };

const appRoute = /^\/(?:api|_next|chat|chats|p|share|login|register|setup|settings|automations|notes|projects|invite|auth)(?:\/|$)/i;

function position(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseWorkspaceFileLink(href: string | undefined): WorkspaceFileLocation | null {
  if (!href) return null;
  let rawPath = href;
  let line: number | undefined;
  let column: number | undefined;
  let endLine: number | undefined;
  let endColumn: number | undefined;
  let explicit = false;
  const workspace = /^workspace:\/\/file\/(.*)$/i.exec(href);
  if (workspace) {
    explicit = true;
    const [pathname, query = ""] = workspace[1].split("?", 2);
    rawPath = pathname;
    const params = new URLSearchParams(query);
    line = position(params.get("line"));
    column = position(params.get("column"));
    endLine = position(params.get("endLine"));
    endColumn = position(params.get("endColumn"));
  } else if (/^file:\/\//i.test(href)) {
    // Never reinterpret another host's file or a Windows drive as a server file.
    if (!/^file:\/\/\//i.test(href)) return null;
    explicit = true;
    rawPath = href.slice("file://".length);
  } else if (!href.startsWith("/") || href.startsWith("//") || appRoute.test(href)) {
    return null;
  }
  if (!workspace) {
    const hashPosition = /#L(\d+)(?:C(\d+))?$/i.exec(rawPath);
    const colonPosition = /:(\d+)(?::(\d+))?$/.exec(rawPath);
    const match = hashPosition || colonPosition;
    if (match) {
      line = position(match[1]);
      column = position(match[2]);
      rawPath = rawPath.slice(0, match.index);
    }
  }
  // Query strings and unknown fragments belong to web links, not filesystem paths.
  if (/[?#]/.test(rawPath)) return null;
  let path: string;
  try { path = decodeURIComponent(rawPath); } catch { return null; }
  if (!path.startsWith("/") || path.startsWith("//") || /^\/[a-z]:[\\/]/i.test(path) || path === "/" || /[\u0000-\u001f\u007f]/.test(path)) return null;
  if (!explicit && appRoute.test(path)) return null;
  return { path, ...(line ? { line } : {}), ...(column ? { column } : {}), ...(endLine && line && endLine >= line ? { endLine } : {}), ...(endColumn && endLine ? { endColumn } : {}) };
}

export function workspaceFileHref(location: WorkspaceFileLocation): string {
  const query = new URLSearchParams();
  if (location.line) query.set("line", String(location.line));
  if (location.column) query.set("column", String(location.column));
  if (location.endLine) query.set("endLine", String(location.endLine));
  if (location.endColumn) query.set("endColumn", String(location.endColumn));
  return `workspace://file/${encodeURIComponent(location.path)}${query.size ? `?${query}` : ""}`;
}

export function workspaceFileDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}
