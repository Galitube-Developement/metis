"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, ImagePlus, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NOTE_BANNER_ACCEPT, uploadNoteBanner } from "@/lib/note-banner-upload";

const icons = [
  ["📝", "Memo"], ["📚", "Books"], ["💡", "Idea"], ["🎯", "Target"],
  ["📋", "Clipboard"], ["📅", "Calendar"], ["📁", "Folder"], ["⭐", "Star"],
  ["🚀", "Rocket"], ["🎨", "Art"], ["🎬", "Film"], ["🎵", "Music"],
  ["🌿", "Leaf"], ["🌍", "Globe"], ["🏠", "Home"], ["🔧", "Tools"],
] as const;

export function NoteIconPicker({ value, onChange }: {
  value: string | null | undefined; onChange: (icon: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  function choose(icon: string | null) { onChange(icon); setOpen(false); }
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setDraft(value || ""); }}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={value ? "Change page icon" : "Add page icon"} title={value ? "Change icon" : "Add icon"}
        className="group relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-2xl transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {value ? <span aria-hidden="true">{value}</span> : <FileText aria-hidden="true" className="size-6 text-muted-foreground" />}
        <Pencil aria-hidden="true" className="absolute bottom-0.5 right-0.5 size-3 rounded-sm bg-background text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-3" aria-label="Page icon picker">
      <p className="mb-2 text-sm font-medium">Page icon</p>
      <div className="grid grid-cols-4 gap-1">
        {icons.map(([icon, label]) => <button key={label} type="button" title={label} aria-label={"Choose " + label} aria-pressed={value === icon}
          onClick={() => choose(icon)}
          className="flex min-h-11 cursor-pointer items-center justify-center rounded-md text-2xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-muted">
          <span aria-hidden="true">{icon}</span>
        </button>)}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); choose(draft.trim() || null); }}>
        <Input aria-label="Custom page icon" placeholder="Your own emoji…" value={draft} maxLength={12} onChange={event => setDraft(event.target.value)} className="h-11 min-w-0 text-base" />
        <Button type="submit" variant="outline" className="h-11">Apply</Button>
      </form>
      {value && <Button type="button" variant="ghost" className="mt-2 h-11 w-full text-muted-foreground" onClick={() => choose(null)}>Remove icon</Button>}
    </PopoverContent>
  </Popover>;
}

export function NoteBannerUpload({ noteId, value, onChange }: {
  noteId: string; value: string | null | undefined; onChange: (cover: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { request.current?.abort(); }, [noteId]);
  async function upload(file: File) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setUploading(true); setError("");
    try {
      const cover = await uploadNoteBanner(noteId, file, controller.signal);
      if (!controller.signal.aborted) onChange(cover);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not upload the banner.");
    } finally {
      if (!controller.signal.aborted) { request.current = null; setUploading(false); }
    }
  }
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-1">
      <Button type="button" variant="ghost" disabled={uploading} className="h-11 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        aria-label={value ? "Change banner" : "Add banner"} onClick={() => input.current?.click()}>
        {uploading ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : value ? <ImagePlus aria-hidden="true" className="size-3.5" /> : <Plus aria-hidden="true" className="size-3.5" />}
        {uploading ? <span role="status">Uploading…</span> : value ? "Change banner" : "Banner"}
      </Button>
      {value && <Button type="button" variant="ghost" disabled={uploading} className="size-11 text-muted-foreground" aria-label="Remove banner" title="Remove banner" onClick={() => { setError(""); onChange(null); }}><Trash2 aria-hidden="true" className="size-3.5" /></Button>}
    </div>
    <input ref={input} type="file" accept={NOTE_BANNER_ACCEPT} hidden aria-label="Upload banner image"
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    {error && <p role="alert" className="max-w-72 pb-2 text-xs text-destructive">{error}</p>}
  </div>;
}
