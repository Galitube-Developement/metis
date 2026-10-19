"use client";

import { useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { ImageSurface } from "@/components/image-viewer";
import { htmlPreviewDocument, markdownPreviewAssetUrl, workspacePreviewUrl, type FilePreviewKind } from "@/lib/file-editor-preview";

export function FileEditorPreview({ path, kind, content }: { path: string; kind: FilePreviewKind; content: string }) {
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const name = path.split("/").pop() || path;
  const url = workspacePreviewUrl(path) + "&v=" + retry;
  const fail = () => setError("This file could not be previewed. Your browser may not support its format.");
  return <div data-file-preview={kind} className="flex h-full min-h-0 flex-col overflow-hidden">
    {error ? <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2 text-xs text-destructive">
      <span className="min-w-0 flex-1">{error}</span>
      <Button size="sm" variant="ghost" onClick={() => { setError(""); setRetry(value => value + 1); }}>Retry preview</Button>
      <a className="text-foreground underline underline-offset-4" href={"/api/remote/download?path=" + encodeURIComponent(path)} download={name}>Download file</a>
    </div> : null}
    <div className="min-h-0 flex-1 overflow-auto">
      {kind === "markdown" ? <article className="mx-auto max-w-3xl break-words px-5 py-6 text-sm leading-7 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted/40 [&_pre]:p-3 [&_pre]:text-xs [&_code]:font-mono [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1 [&_img]:max-w-full">
        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url, key) => key === "src" ? markdownPreviewAssetUrl(defaultUrlTransform(url), path) : defaultUrlTransform(url)} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{content}</ReactMarkdown>
      </article> : kind === "html" || kind === "svg" ? <iframe title={"Preview of " + name} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={htmlPreviewDocument(content)} className="h-full min-h-80 w-full border-0 bg-white" />
      : kind === "image" ? <div className="h-full min-h-40 p-4"><ImageSurface key={url} src={url} alt={name} /></div>
      : kind === "video" ? <div className="flex min-h-full items-center justify-center p-4"><video key={url} src={url} controls playsInline preload="metadata" aria-label={name} className="max-h-full w-full object-contain" onError={fail} /></div>
      : kind === "audio" ? <div className="flex min-h-full items-center justify-center p-4"><audio key={url} src={url} controls preload="metadata" aria-label={name} className="w-full max-w-xl" onError={fail} /></div>
      : <iframe key={url} src={url} title={"Preview of " + name} className="h-full min-h-80 w-full border-0" onError={fail} />}
    </div>
  </div>;
}
