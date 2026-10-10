"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_AGENT_RUNTIME_MS, MIN_AGENT_RUNTIME_MS } from "@/lib/agent-runtime-policy.mjs";

export function AgentRuntimeSettings() {
  const [minutes, setMinutes] = useState("");
  const [savedRuntimeMs, setSavedRuntimeMs] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const saveController = useRef<AbortController | null>(null);
  const minMinutes = MIN_AGENT_RUNTIME_MS / 60_000;
  const value = Number(minutes);
  const runtimeMs = unlimited ? 0 : value * 60_000;
  const valid = unlimited || (minutes.trim() !== "" && Number.isSafeInteger(runtimeMs) && Number.isInteger(value) && value >= minMinutes);

  useEffect(() => {
    const controller = new AbortController();
    setSavedRuntimeMs(null);
    setError("");
    void fetch("/api/agent-settings", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load agent settings.");
        if (!controller.signal.aborted) {
          setMinutes(String((data.runtimeMs || DEFAULT_AGENT_RUNTIME_MS) / 60_000));
          setUnlimited(data.runtimeMs === 0);
          setSavedRuntimeMs(data.runtimeMs);
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
    if (busy || savedRuntimeMs === null || !valid) return;
    const controller = new AbortController();
    saveController.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/agent-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtimeMs }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save agent settings.");
      if (!controller.signal.aborted) {
        setMinutes(String((data.runtimeMs || DEFAULT_AGENT_RUNTIME_MS) / 60_000));
        setUnlimited(data.runtimeMs === 0);
        setSavedRuntimeMs(data.runtimeMs);
        setNotice(data.runtimeMs === 0 ? "Saved. New agent runs have no automatic runtime limit." : "Saved. New agent runs will use this limit.");
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
        <div className="flex min-h-11 items-center gap-3">
          <Switch id="agent-runtime-unlimited" checked={unlimited} disabled={savedRuntimeMs === null || busy} onCheckedChange={checked => { setUnlimited(checked); setNotice(""); }} />
          <label htmlFor="agent-runtime-unlimited" className="cursor-pointer text-sm">Unlimited</label>
        </div>
        <Input
          id="agent-runtime-minutes"
          name="agent-runtime-minutes"
          type="number"
          inputMode="numeric"
          autoComplete="off"
          min={minMinutes}
          step={1}
          value={minutes}
          onChange={event => { setMinutes(event.target.value); setNotice(""); }}
          disabled={savedRuntimeMs === null || busy || unlimited}
          aria-describedby="agent-runtime-help agent-runtime-range"
          aria-invalid={savedRuntimeMs !== null && !valid}
          className="min-h-11 max-w-40 sm:min-h-8"
        />
        <p id="agent-runtime-range" className="text-xs text-muted-foreground">
          At least {minMinutes} minutes, with no fixed maximum, or Unlimited. Default: {DEFAULT_AGENT_RUNTIME_MS / 60_000} minutes.
        </p>
      </div>
      <div className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        When a coordinator reaches its limit, assigned work keeps running with its own limit.
        Stop or cancel still ends the selected agent and its child tasks.
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void save()} disabled={busy || savedRuntimeMs === null || !valid || runtimeMs === savedRuntimeMs} className="min-h-11 sm:min-h-8">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" disabled={busy || savedRuntimeMs === null || runtimeMs === DEFAULT_AGENT_RUNTIME_MS} onClick={() => { setMinutes(String(DEFAULT_AGENT_RUNTIME_MS / 60_000)); setUnlimited(false); setNotice(""); }} className="min-h-11 sm:min-h-8">
          Restore default
        </Button>
      </div>
      {savedRuntimeMs === null && !error ? <p role="status" className="text-xs text-muted-foreground">Loading agent settings…</p> : null}
      {savedRuntimeMs !== null && !valid ? <p role="alert" className="text-xs text-destructive">Enter at least {minMinutes} whole minutes, or choose Unlimited.</p> : null}
      {error ? <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-xs text-destructive">{error}</p>
        {savedRuntimeMs === null ? <Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry</Button> : null}
      </div> : null}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{notice}</p>
    </section>
  );
}
