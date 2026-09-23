"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type ProjectMemoryItem = {
  id: string;
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

export function ProjectMemoryManager({
  projectId,
  memories,
  onChanged,
}: {
  projectId: string;
  memories: ProjectMemoryItem[];
  onChanged: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectMemoryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const request = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, init);
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update project memory.");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update project memory.");
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const addMemory = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    try {
      await request(`/api/projects/${encodeURIComponent(projectId)}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setDraft("");
    } catch {
      // The inline error from request is the actionable state.
    }
  };

  const saveEdit = async () => {
    const content = editingContent.trim();
    if (!editingId || !content || busy) return;
    try {
      await request(
        `/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(editingId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      setEditingId(null);
      setEditingContent("");
    } catch {
      // The inline error from request is the actionable state.
    }
  };

  return (
    <div className="grid gap-3">
      <p className="text-xs leading-5 text-muted-foreground">
        Durable facts available to the agent in every chat in this project. Memory tools update this list automatically.
      </p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a project-specific fact or preference"
          aria-label="New project memory"
          rows={2}
          className="min-h-20 resize-y rounded-xl"
          disabled={busy}
        />
        <Button type="button" className="h-10 sm:self-end" onClick={() => void addMemory()} disabled={busy || !draft.trim()}>
          <Plus className="size-4" />
          Add memory
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {memories.length ? (
        <ul className="divide-y divide-border/45 border-y border-border/45">
          {memories.map((memory) => (
            <li key={memory.id} className="py-3">
              {editingId === memory.id ? (
                <div className="grid gap-2">
                  <Textarea
                    value={editingContent}
                    onChange={(event) => setEditingContent(event.target.value)}
                    aria-label="Edit project memory"
                    rows={3}
                    className="min-h-24 resize-y rounded-xl"
                    disabled={busy}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingId(null);
                        setEditingContent("");
                      }}
                      disabled={busy}
                    >
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                    <Button type="button" size="sm" onClick={() => void saveEdit()} disabled={busy || !editingContent.trim()}>
                      Save memory
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6">{memory.content}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit project memory"
                      title="Edit memory"
                      onClick={() => {
                        setEditingId(memory.id);
                        setEditingContent(memory.content);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete project memory"
                      title="Delete memory"
                      onClick={() => setDeleteTarget(memory)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-xs leading-5 text-muted-foreground">
          No project memories yet. Add the first fact above or ask the agent to remember something in a project chat.
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete project memory?"
        description="This fact will no longer be available to chats in this project."
        confirmLabel="Delete memory"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await request(
            `/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(deleteTarget.id)}`,
            { method: "DELETE" },
          );
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
