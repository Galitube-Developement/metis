import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { isInsideWorkspace } from "@/lib/user-isolation";
import { fileResponse } from "@/lib/file-response";
import { mimeTypeFromFileName } from "@/lib/file-types";

/** Download original bytes, never the editor's line-limited text preview. */
export function workspaceFileDownload(root: string, requestedPath: string, req: Request) {
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
    url.searchParams.set("download", "1");
    return fileResponse(canonical, { name, mimeType: mimeTypeFromFileName(name) }, new Request(url, { headers: req.headers }));
  } catch {
    return Response.json({ error: "File not found or not readable." }, { status: 404 });
  }
}
