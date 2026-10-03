"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type MemoryItem = {
  id: string;
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  namespace?: "profile" | "preferences" | "device" | "project" | "infrastructure" | "software" | "workflow" | "semantic";
  source?: "user" | "conversation";
  confidence?: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memories: MemoryItem[];
  onChanged: () => void;
};

export function MemoriesPanel({
  open,
  onOpenChange,
  memories,
  onChanged,
}: Props) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const visibleMemories = memories.filter((memory) => {
    const query = search.trim().toLocaleLowerCase();
    return !query || [memory.content, memory.namespace, ...(memory.tags || [])]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  });

  async function addMemory() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || "Could not add rule",
        );
      }
      setDraft("");
      onChanged();
      toast.success("Rule saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add rule");
    } finally {
      setBusy(false);
    }
  }

  async function removeMemory(id: string) {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      onChanged();
      toast.success("Rule deleted");
    } catch {
      toast.error("Could not delete rule");
    }
  }

  async function saveMemory(id: string) {
    const content = editingValue.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Could not update rule");
      setEditingId(null);
      setEditingValue("");
      onChanged();
      toast.success("Rule updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update rule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Agent Rules</SheetTitle>
          <SheetDescription>
            The agent applies these rules and context when they help with a request. Add, edit, search, or delete them here.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2 px-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add an agent rule…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addMemory();
              }
            }}
          />
          <Button
            size="icon"
            onClick={() => void addMemory()}
            disabled={busy || !draft.trim()}
            aria-label="Add rule"
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search agent rules"
          aria-label="Search agent rules"
          className="mt-4"
        />

        <ScrollArea className="mt-3 flex-1 pr-2">
          <ul className="space-y-2 pb-6">
            {memories.length === 0 ? (
              <li className="px-1 py-8 text-center text-sm text-muted-foreground">
                No agent rules yet.
              </li>
            ) : visibleMemories.length === 0 ? (
              <li className="px-1 py-8 text-center text-sm text-muted-foreground">
                No agent rules match “{search}”.
              </li>
            ) : (
              visibleMemories.map((m) => (
                <li
                  key={m.id}
                  className="group flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-3"
                >
                  <div className="min-w-0 flex-1">
                    {editingId === m.id ? (
                      <Input
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveMemory(m.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        className="h-8 text-sm"
                        aria-label="Edit rule"
                      />
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[m.namespace, m.source === "conversation" ? "Learned in conversation" : undefined, ...(m.tags || [])]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-60 group-hover:opacity-100"
                    onClick={() => void removeMemory(m.id)}
                    aria-label="Delete rule"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  {editingId === m.id ? (
                    <>
                      <Button variant="ghost" size="icon-sm" onClick={() => void saveMemory(m.id)} disabled={busy || !editingValue.trim()} aria-label="Save rule">
                        <Check className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditingId(null)} aria-label="Cancel editing rule">
                        <X className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-60 group-hover:opacity-100"
                      onClick={() => {
                        setEditingId(m.id);
                        setEditingValue(m.content);
                      }}
                      aria-label="Edit rule"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
