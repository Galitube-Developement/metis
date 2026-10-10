"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_AGENT_RUNTIME_MS, MAX_AGENT_RUNTIME_MS } from "@/lib/agent-runtime-policy.mjs";

export function AgentRuntimeSettings() {
  const [minutes, setMinutes] = useState("");
  const [savedMinutes, setSavedMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const saveController = useRef<AbortController | null>(null);
  const maxMinutes = MAX_AGENT_RUNTIME_MS / 60_000;
  const value = Number(minutes);
  const valid = minutes.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= maxMinutes;

  useEffect(() => {
    const controller = new AbortController();
    setSavedMinutes(null);
    setError("");
    void fetch("/api/agent-settings", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load agent settings.");
        if (!controller.signal.aborted) {
          setMinutes(String(data.runtimeMs / 60_000));
          setSavedMinutes(data.runtimeMs / 60_000);
        }
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load agent settings.");
      });
    return () => {
      controller.abort();
      saveController.current?.abort();
    };
  }, [reload]);

  async function save() {
    if (busy || savedMinutes === null || !valid) return;
    const controller = new AbortController();
    saveController.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/agent-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtimeMs: value * 60_000 }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save agent settings.");
      if (!controller.signal.aborted) {
        setMinutes(String(data.runtimeMs / 60_000));
        setSavedMinutes(data.runtimeMs / 60_000);
        setNotice("Saved. New agent runs will use this limit.");
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not save agent settings.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="flex max-w-2xl flex-col gap-5" aria-label="Agent runtime settings">
      <div className="space-y-2">
        <label htmlFor="agent-runtime-minutes" className="text-sm font-medium">Default runtime (minutes)</label>
        <p id="agent-runtime-help" className="text-xs leading-relaxed text-muted-foreground">
          Applies to new subagents and project agents, including coordinators and background runs.
          Existing runs keep their limit. An agent can request a different limit for an individual task.
        </p>
        <Input
          id="agent-runtime-minutes"
          name="agent-runtime-minutes"
          type="number"
          inputMode="numeric"
          autoComplete="off"
          min={1}
          max={maxMinutes}
          step={1}
          value={minutes}
          onChange={event => { setMinutes(event.target.value); setNotice(""); }}
          disabled={savedMinutes === null || busy}
          aria-describedby="agent-runtime-help agent-runtime-range"
          aria-invalid={savedMinutes !== null && !valid}
          className="min-h-11 max-w-40 sm:min-h-8"
        />
        <p id="agent-runtime-range" className="text-xs text-muted-foreground">
          1–{maxMinutes} minutes. Maximum 6 hours; default {DEFAULT_AGENT_RUNTIME_MS / 60_000} minutes.
        </p>
      </div>
      <div className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        When a coordinator reaches its limit, assigned work keeps running with its own limit.
        Stop or cancel still ends the selected agent and its child tasks.
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void save()} disabled={busy || savedMinutes === null || !valid || value === savedMinutes} className="min-h-11 sm:min-h-8">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" disabled={busy || savedMinutes === null || value === DEFAULT_AGENT_RUNTIME_MS / 60_000} onClick={() => { setMinutes(String(DEFAULT_AGENT_RUNTIME_MS / 60_000)); setNotice(""); }} className="min-h-11 sm:min-h-8">
          Restore default
        </Button>
      </div>
      {savedMinutes === null && !error ? <p role="status" className="text-xs text-muted-foreground">Loading agent settings…</p> : null}
      {savedMinutes !== null && !valid ? <p role="alert" className="text-xs text-destructive">Enter a whole number from 1 to {maxMinutes}.</p> : null}
      {error ? <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-xs text-destructive">{error}</p>
        {savedMinutes === null ? <Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry</Button> : null}
      </div> : null}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{notice}</p>
    </section>
  );
}
