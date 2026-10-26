"use client";
import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export function ProviderRecoverySetting({ endpoint, id, label, description, applicability }: {
  endpoint: string; id: string; label: string; description: string; applicability: string;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const saveController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setEnabled(null);
    setError("");
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || typeof data.enabled !== "boolean") throw new Error(data.error || "Could not load provider recovery settings.");
        if (!controller.signal.aborted) setEnabled(data.enabled);
      }).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load provider recovery settings.");
      });
    return () => { controller.abort(); saveController.current?.abort(); };
  }, [reload, endpoint]);
  async function save(value: boolean) {
    if (busy || enabled === null) return;
    const controller = new AbortController();
    saveController.current = controller;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: value }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || typeof data.enabled !== "boolean") throw new Error(data.error || "Could not save provider recovery settings.");
      if (!controller.signal.aborted) { setEnabled(data.enabled); setNotice("Saved."); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not save provider recovery settings.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="space-y-3" aria-busy={busy || (enabled === null && !error)}>
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={enabled === true} disabled={enabled === null || busy} onCheckedChange={value => void save(value)} />
    </div>
    {enabled === null && !error && <p role="status" className="text-sm text-muted-foreground">Loading settings…</p>}
    <p className="text-sm text-muted-foreground">{applicability}</p>
    {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p>{enabled === null && <Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry</Button>}</div>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </section>;
}
