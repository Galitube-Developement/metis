"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Globe2, Pin, Search } from "lucide-react";
import type { SharedNote } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type ChatOption = { id: string; title: string };

export function NotePinDialog({
  note,
  open,
  confirmLabel = "Save pin settings",
  onOpenChange,
  onSaved,
}: {
  note: SharedNote | null;
  open: boolean;
  confirmLabel?: string;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [everywhere, setEverywhere] = useState(false);
  const [chatIds, setChatIds] = useState<string[]>([]);
  const [chats, setChats] = useState<ChatOption[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const initialized = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);

  async function loadPage(offset: number, noteId: string, controller: AbortController) {
    try {
      const params = new URLSearchParams({noteId, picker:"1", search, offset:String(offset)});
      const response = await fetch(`/api/context/pins?${params}`, {cache:"no-store", signal:controller.signal});
      if (!response.ok) throw new Error("Could not load pin settings. Please retry.");
      const data = await response.json() as {chats?:ChatOption[];globalNoteIds?:string[];configuredChatIds?:string[];nextOffset?:number|null};
      if (controller.signal.aborted) return;
      setChats(current => offset ? [...current, ...(data.chats || []).filter(chat => !current.some(item=>item.id===chat.id))] : data.chats || []);
      setNextOffset(data.nextOffset ?? null);
      if (initialized.current !== noteId) {
        const global = Boolean(data.globalNoteIds?.includes(noteId));
        setEverywhere(global);
        setChatIds(global ? [] : data.configuredChatIds || []);
        initialized.current = noteId;
        setReady(true);
      }
      setError("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load pin settings.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  // Ref keeps this effect scoped to navigation/search, not every selection change.
  const loadPageRef = useRef(loadPage);
  loadPageRef.current = loadPage;
  useEffect(() => {
    if (!open || !note?.id) {
      initialized.current = null;
      setReady(false);
      return;
    }
    const noteId = note.id;
    if (initialized.current !== noteId) setReady(false);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setChats([]);
    setNextOffset(null);
    setError("");
    const timer = window.setTimeout(() => void loadPageRef.current(0, noteId, controller), search ? 180 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); request.current?.abort(); };
  }, [note?.id, open, search]);

  function loadMore() {
    if (nextOffset === null || !note || loading) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    void loadPageRef.current(nextOffset, note.id, controller);
  }

  function toggleChat(id: string) {
    setChatIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const filteredChats = chats;

  async function save() {
    if (!note || !ready) return;
    const savingNoteId = note.id;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/context/pins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: note.id, everywhere, chatIds }),
      });
      if (!response.ok) throw new Error("Could not save pin settings");
      if (initialized.current === savingNoteId) {
        onSaved?.();
        onOpenChange(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save pin settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="box-border min-w-[40vw] w-[min(90vw,42rem)] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-start gap-2 pr-10 leading-5">
            <Pin className="size-4 text-primary" />
            <span className="min-w-0 break-words">Pin “{note?.title || "Untitled note"}”</span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-w-0 max-w-full space-y-3">
          <button
            type="button"
            className={cn("flex min-w-0 max-w-full items-center gap-3 rounded-xl border p-3 text-left", everywhere ? "border-primary bg-primary/10" : "border-border/60")}
            disabled={!ready || saving}
            onClick={() => {
              setEverywhere((value) => !value);
              setChatIds([]);
            }}
          >
            <Globe2 className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Everywhere</span>
              <span className="block text-xs text-muted-foreground">Show this note in every chat</span>
            </span>
            {everywhere ? <Check className="size-4 text-primary" /> : null}
          </button>
          <div className="min-h-0 space-y-2">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search chats…"
                  aria-label="Search chats"
                  className="h-9 pl-8"
                />
              </div>
              <div className="flex min-w-0 max-w-full flex-wrap justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-w-0 px-2 text-xs"
                  disabled={!ready || saving || everywhere || !filteredChats.length}
                  onClick={() => setChatIds((current) => [...new Set([...current, ...filteredChats.map((chat) => chat.id)])])}
                >
                  Select loaded
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-w-0 px-2 text-xs"
                  disabled={!ready || saving || everywhere || !filteredChats.length}
                  onClick={() => {
                    const visibleIds = new Set(filteredChats.map((chat) => chat.id));
                    setChatIds((current) => current.filter((id) => !visibleIds.has(id)));
                  }}
                >
                  Deselect loaded
                </Button>
              </div>
            </div>
            <div className="min-w-0 max-w-full max-h-[min(40vh,18rem)] space-y-1 overflow-x-hidden overflow-y-auto rounded-xl border border-border/60 p-2">
            {filteredChats.length ? filteredChats.map((chat) => {
              const selected = !everywhere && chatIds.includes(chat.id);
              return (
                <button
                  key={chat.id}
                  type="button"
                  disabled={!ready || saving}
                  aria-pressed={selected}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs", selected ? "bg-primary/10" : "hover:bg-muted/60")}
                  onClick={() => {
                    setEverywhere(false);
                    toggleChat(chat.id);
                  }}
                >
                  <span className={cn("flex size-4 items-center justify-center rounded border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {selected ? <Check className="size-3" /> : null}
                  </span>
                  <span className="truncate">{chat.title}</span>
                </button>
              );
            }) : !loading && !error ? <p className="p-2 text-xs text-muted-foreground">{search ? "No chats match your search." : "No chats available yet."}</p> : null}
            {loading ? <p role="status" className="p-2 text-xs text-muted-foreground">Loading chats…</p> : null}
            {nextOffset !== null ? <Button type="button" variant="ghost" size="sm" disabled={loading || saving} onClick={loadMore}>Load more chats</Button> : null}
            </div>
          </div>
        </div>
        {error ? <div role="alert" className="text-sm text-destructive">{error}<Button type="button" variant="ghost" size="sm" disabled={loading || saving} onClick={() => {
          if (!note) return;
          request.current?.abort();
          const controller = new AbortController();
          request.current = controller;
          setLoading(true);
          void loadPageRef.current(0, note.id, controller);
        }}>Retry loading</Button></div> : null}
        <DialogFooter className="min-w-0 max-w-full sm:flex-row sm:flex-wrap sm:items-center [&>button]:min-w-0 [&>button]:max-w-full [&>button]:shrink-0 [&>button]:whitespace-normal">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={saving || !note || !ready} onClick={() => void save()}>{saving ? "Saving…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
