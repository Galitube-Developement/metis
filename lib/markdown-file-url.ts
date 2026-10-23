import { markdownPreviewAssetUrl } from "@/lib/file-editor-preview";
import { parseWorkspaceFileLink, workspaceFileHref } from "@/lib/workspace-file-link";

/** Resolve display URLs against the server file while leaving the Markdown source untouched. */
export function markdownFileDisplayUrl(source: string, filePath: string, kind: "image" | "link"): string {
  if (kind === "image") return markdownPreviewAssetUrl(source, filePath);
  if (!source || source.startsWith("#") || source.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith("/api/")) return source;
  try {
    const base = "https://workspace.invalid" + filePath.split("/").map(encodeURIComponent).join("/");
    const target = new URL(source, base);
    const position = /^#L(\d+)(?:C(\d+))?$/i.exec(target.hash);
    const href = workspaceFileHref({
      path: decodeURIComponent(target.pathname),
      ...(position ? { line: Number(position[1]), ...(position[2] ? { column: Number(position[2]) } : {}) } : {}),
    });
    return parseWorkspaceFileLink(href) ? href : "";
  } catch { return ""; }
}
