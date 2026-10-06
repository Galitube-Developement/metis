"use client";
import { Download, File } from "lucide-react";
import type { SharedNote } from "@/lib/store";
import { formatFileBytes } from "@/lib/upload-limits";
export function NoteMedia({ note }: { note: SharedNote }) {
  const asset = note.asset;
  if (!asset) return null;
  const url = `/api/file-uploads/${encodeURIComponent(asset.id)}/file`;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-note-media={asset.kind}>
    {asset.kind === "image" ?
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={note.title || asset.name} draggable={false} className="min-h-0 flex-1 select-none object-contain p-1" />
      : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-3 text-black/70">
        <File className="size-9 shrink-0" />
        <p className="max-w-full truncate text-xs font-medium" title={asset.name}>{asset.name}</p>
      </div>}
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-black/10 px-2 py-1.5 text-[11px] text-black/65">
      <span>{formatFileBytes(asset.size)}</span>
      <a href={url} download={asset.name} className="inline-flex items-center gap-1 rounded px-1 hover:bg-black/10 focus-visible:outline" onPointerDown={(event) => event.stopPropagation()}><Download className="size-3" />Download</a>
    </div>
  </div>;
}
