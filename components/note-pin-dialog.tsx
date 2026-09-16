"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!open) return;
    void fetch(`/api/context/pins?noteId=${encodeURIComponent(note?.id || "")}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { chats?: ChatOption[]; globalNoteIds?: string[]; configuredChatIds?: string[] } | null) => {
        setChats(data?.chats || []);
        const isEverywhere = Boolean(note && data?.globalNoteIds?.includes(note.id));
        setEverywhere(isEverywhere);
        setChatIds(isEverywhere ? [] : data?.configuredChatIds || []);
      })
      .catch(() => setChats([]));
  }, [note, open]);

  function toggleChat(id: string) {
    setChatIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const filteredChats = chats.filter((chat) => chat.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  async function save() {
    if (!note) return;
    setSaving(true);
    try {
      const response = await fetch("/api/context/pins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: note.id, everywhere, chatIds }),
      });
      if (!response.ok) throw new Error("Could not save pin settings");
      onSaved?.();
      onOpenChange(false);
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
                  disabled={everywhere || !filteredChats.length}
                  onClick={() => setChatIds((current) => [...new Set([...current, ...filteredChats.map((chat) => chat.id)])])}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-w-0 px-2 text-xs"
                  disabled={everywhere || !filteredChats.length}
                  onClick={() => {
                    const visibleIds = new Set(filteredChats.map((chat) => chat.id));
                    setChatIds((current) => current.filter((id) => !visibleIds.has(id)));
                  }}
                >
                  Deselect all
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
            }) : <p className="p-2 text-xs text-muted-foreground">{chats.length ? "No chats match your search." : "No chats available yet."}</p>}
            </div>
          </div>
        </div>
        <DialogFooter className="min-w-0 max-w-full sm:flex-row sm:flex-wrap sm:items-center [&>button]:min-w-0 [&>button]:max-w-full [&>button]:shrink-0 [&>button]:whitespace-normal">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={saving || !note} onClick={() => void save()}>{saving ? "Saving…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
