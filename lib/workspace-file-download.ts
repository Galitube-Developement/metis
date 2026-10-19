import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { isInsideWorkspace } from "@/lib/user-isolation";
import { fileResponse } from "@/lib/file-response";
import { fileViewKind, mimeTypeFromFileName } from "@/lib/file-types";

/** Download original bytes, never the editor's line-limited text preview. */
export function workspaceFileDownload(root: string, requestedPath: string, req: Request, options: { inline?: boolean } = {}) {
  if (!requestedPath.trim()) return Response.json({ error: "A file path is required" }, { status: 400 });
  const candidate = path.resolve(root, requestedPath);
  if (!isInsideWorkspace(root, candidate)) return Response.json({ error: "File must be inside the agent workspace." }, { status: 403 });
  try {
    const canonical = realpathSync(candidate);
    if (!isInsideWorkspace(realpathSync(root), canonical)) return Response.json({ error: "File must be inside the agent workspace." }, { status: 403 });
    if (!statSync(canonical).isFile()) return Response.json({ error: "The selected path is not a file." }, { status: 400 });
    const name = path.basename(candidate);
    const downloadRequest = new Request(req);
    const url = new URL(downloadRequest.url);
    const mimeType = mimeTypeFromFileName(name);
    if (options.inline) {
      if (!["image", "video", "audio", "pdf"].includes(fileViewKind(mimeType, name)) || mimeType === "image/svg+xml") {
        return Response.json({ error: "Preview is unavailable for this file type." }, { status: 415 });
      }
      url.searchParams.delete("download");
    } else url.searchParams.set("download", "1");
    return fileResponse(canonical, { name, mimeType }, new Request(url, { method: req.method, headers: req.headers }));
  } catch {
    return Response.json({ error: "File not found or not readable." }, { status: 404 });
  }
}
