"use client";

import { Children, isValidElement, useEffect, useState, type ReactNode, type AnchorHTMLAttributes } from "react";
import { File } from "lucide-react";
import { HoverPreview } from "@/components/hover-preview";
import { FileEmbed } from "@/components/file-embed";
import { fileDownloadUrl, fileViewKind, mimeTypeFromFileName, type FileEmbedSpec } from "@/lib/file-types";
import { parseWorkspaceFileLink, type WorkspaceFileLocation } from "@/lib/workspace-file-link";
import { cn } from "@/lib/utils";

function linkLabel(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === "string" || typeof child === "number" ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? linkLabel(child.props.children) : "").join("");
}

function FilePreviewContent({ file, location }: { file: FileEmbedSpec; location: WorkspaceFileLocation | null }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const kind = fileViewKind(file.mimeType, file.name);
  useEffect(() => {
    if (!location || kind !== "text") return;
    const controller = new AbortController();
    fetch("/api/remote", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", path: location.path, preview: true, line: location.line }),
      signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Preview unavailable. Click the link to open the file.");
        const data = await response.json() as { content?: string };
        return typeof data.content === "string" ? data.content : "";
      }).then(setText).catch(() => { if (!controller.signal.aborted) setError("Preview unavailable. Click the link to open the file."); });
    return () => controller.abort();
  }, [location?.path, location?.line, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <div className="flex items-start gap-2.5">
      <File className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{file.name}</div>
        <div className="mt-1 truncate text-[11px] text-muted-foreground">{location ? location.path + (location.line ? ":" + location.line : "") : file.mimeType}</div>
      </div>
    </div>
    {location ? <pre className="mt-2 max-h-44 overflow-hidden whitespace-pre-wrap break-words rounded-md bg-background p-2 font-mono text-[11px] leading-4">
      {error || (kind !== "text" ? "Click the link to open this file in the workspace." : text === null ? "Loading preview…" : text || "No preview content.")}
    </pre> : <FileEmbed file={file} previewOnly resizable={false} className="mt-2 max-h-44 rounded-md [&_iframe]:min-h-36 [&_pre]:p-2 [&_pre]:pr-2 [&_pre]:text-[11px]" />}
  </>;
}

export function FileLink({ href = "", children, file, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { file?: FileEmbedSpec }) {
  const location = parseWorkspaceFileLink(href);
  const name = file?.name || location?.path.split("/").pop() || (linkLabel(children) || "File");
  const spec = file || { url: href, name, mimeType: mimeTypeFromFileName(name) };
  return <HoverPreview content={<FilePreviewContent key={href} file={spec} location={location} />}>
    <a {...props} href={location ? "#workspace-file" : fileDownloadUrl(href)}
      download={location ? undefined : spec.name}
      className={cn("file-reference-link", props.className)} data-workspace-file={location?.path}
      onClick={event => {
        props.onClick?.(event);
        if (location && !event.defaultPrevented) {
          event.preventDefault(); event.stopPropagation();
          window.dispatchEvent(new CustomEvent("ai-chat:open-file", { detail: location }));
        }
      }}>
      <File className="mr-1 inline-block size-[1em] align-[-0.15em]" aria-hidden="true" />
      {children || spec.name}
    </a>
  </HoverPreview>;
}
