"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentRule } from "@/lib/store";

export function AgentRulesSettings({ onRuleCountChange }: { onRuleCountChange?: (count: number) => void }) {
  const [rules, setRules] = useState<AgentRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    setError("");
    void fetch("/api/agent-rules", { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load agent rules.");
        if (!controller.signal.aborted) {
          setRules(data.rules);
          onRuleCountChange?.(data.rules.length);
          setLoaded(true);
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load agent rules.");
      });
    return () => controller.abort();
  }, [reload, onRuleCountChange]);

  const mutate = async (method: "POST" | "PATCH" | "DELETE", id?: string, content?: string) => {
    if (busy || !loaded) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(id ? "/api/agent-rules/" + encodeURIComponent(id) : "/api/agent-rules", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(content !== undefined ? { body: JSON.stringify({ content }) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save agent rules.");
      setRules(data.rules);
      onRuleCountChange?.(data.rules.length);
      if (method === "POST") setDraft("");
      if (id === editingId) setEditingId(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save agent rules.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex max-w-3xl flex-col gap-4" aria-label="Agent Rules">
      <p className="text-xs text-muted-foreground">
        Add one instruction per rule. Rules guide future replies across your chats; Memories store useful facts and context.
      </p>
      {loaded ? <p role="status" className="text-xs text-muted-foreground">{rules.length} {rules.length === 1 ? "rule" : "rules"} set</p> : null}
      <div className="flex items-center gap-2">
        <Textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Add an agent rule…"
          aria-label="New agent rule"
          rows={1}
          maxLength={20_000}
          disabled={!loaded || busy}
          className="h-8 min-h-8 field-sizing-fixed resize-none py-1 text-sm leading-5"
        />
        <Button size="icon" type="button" disabled={!loaded || busy || !draft.trim()} onClick={() => void mutate("POST", undefined, draft)} aria-label="Add rule">
          <Plus className="size-4" />
        </Button>
      </div>
      {error ? (
        <div className="flex items-center gap-3">
          <p role="alert" className="text-xs text-destructive">{error}</p>
          {!loaded ? <Button size="sm" variant="outline" onClick={() => setReload(value => value + 1)}>Retry</Button> : null}
        </div>
      ) : null}
      {!loaded && !error ? <p role="status" className="text-xs text-muted-foreground">Loading agent rules…</p> : null}
      {loaded ? (
        <ul className="flex flex-col gap-2">
          {rules.length === 0 ? <li className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">No agent rules yet.</li> : rules.map(rule => (
            <li key={rule.id} className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-3">
              {editingId === rule.id ? (
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Textarea value={editContent} onChange={event => setEditContent(event.target.value)} rows={3} maxLength={20_000} disabled={busy} aria-label="Edit agent rule" className="resize-y text-sm" autoFocus />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy || !editContent.trim()} onClick={() => void mutate("PATCH", rule.id, editContent)}>Save rule</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{rule.content}</p>}
              {editingId !== rule.id ? <Button size="icon-sm" variant="ghost" disabled={busy} aria-label="Edit rule" onClick={() => { setEditingId(rule.id); setEditContent(rule.content); }}><Pencil className="size-3.5" /></Button> : null}
              <Button size="icon-sm" variant="ghost" disabled={busy} aria-label="Delete rule" onClick={() => void mutate("DELETE", rule.id)}><Trash2 className="size-3.5" /></Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
