"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_ATTACHMENT_MAX_BYTES, formatFileBytes } from "@/lib/upload-limits";

export function AttachmentSettings({ summary = false }: { summary?: boolean }) {
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState("GB");
  const [unlimited, setUnlimited] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const saveController = useRef<AbortController | null>(null);
  const maxBytes = unlimited ? 0 : Number(amount) * 1024 ** (unit === "GB" ? 3 : 2);
  const valid = unlimited || (amount.trim() !== "" && Number.isSafeInteger(maxBytes) && maxBytes > 0);

  function apply(bytes: number) {
    const value = bytes || DEFAULT_ATTACHMENT_MAX_BYTES;
    const nextUnit = value >= 1024 ** 3 ? "GB" : "MB";
    setUnit(nextUnit);
    setAmount(String(value / 1024 ** (nextUnit === "GB" ? 3 : 2)));
    setUnlimited(bytes === 0);
    setSaved(bytes);
  }

  useEffect(() => {
    const controller = new AbortController();
    setSaved(null);
    setError("");
    void fetch("/api/attachment-settings", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load attachment settings.");
        if (!controller.signal.aborted) apply(data.maxBytes);
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load attachment settings.");
      });
    return () => { controller.abort(); saveController.current?.abort(); };
  }, [reload]);

  async function save() {
    if (busy || saved === null || !valid) return;
    const controller = new AbortController();
    saveController.current = controller;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/attachment-settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxBytes }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save attachment settings.");
      if (!controller.signal.aborted) {
        apply(data.maxBytes);
        setNotice(data.maxBytes === 0 ? "Saved. New attachments have no size limit." : "Saved. New attachments use this limit.");
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not save attachment settings.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const disabled = saved === null || busy;
  if (summary) return <span>{error ? "Unavailable · open to retry" : saved === null ? "Loading…" : saved === 0 ? "Unlimited" : `${formatFileBytes(saved)} per file`}</span>;
  return <div className="flex max-w-2xl flex-col gap-4">
    <p id="attachment-size-help" className="text-xs leading-relaxed text-muted-foreground">
      Set the maximum size per file for your account. Applies to new uploads in chats, notes and file transfers.
      Existing uploads stay available.
    </p>
    <div className="flex min-h-11 items-center gap-3">
      <Switch id="attachment-size-unlimited" checked={unlimited} disabled={disabled} onCheckedChange={checked => { setUnlimited(checked); setNotice(""); }} />
      <label htmlFor="attachment-size-unlimited" className="cursor-pointer text-sm">Unlimited</label>
    </div>
    <div className="space-y-2">
      <label htmlFor="attachment-size-value" className="text-xs font-medium">Maximum file size</label>
      <div className="flex flex-wrap gap-2">
        <Input id="attachment-size-value" type="number" inputMode="decimal" min="0" step="any"
          value={amount} disabled={disabled || unlimited}
          onChange={event => { setAmount(event.target.value); setNotice(""); }}
          aria-describedby="attachment-size-help" aria-invalid={saved !== null && !valid}
          className="min-h-11 w-36 sm:min-h-9" />
        <select aria-label="File size unit" value={unit} disabled={disabled || unlimited}
          onChange={event => { setUnit(event.target.value); setNotice(""); }}
          className="min-h-11 rounded-md border border-input bg-background px-3 text-sm sm:min-h-9">
          <option value="MB">MB</option><option value="GB">GB</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground">Default: {formatFileBytes(DEFAULT_ATTACHMENT_MAX_BYTES)} per file. Choose any positive size or Unlimited.</p>
      <p className="text-xs text-muted-foreground">Available storage and limits of connected services still apply.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={disabled || !valid || maxBytes === saved} onClick={() => void save()} className="min-h-11 sm:min-h-9">{busy ? "Saving…" : "Save"}</Button>
      <Button type="button" variant="outline" disabled={disabled || maxBytes === DEFAULT_ATTACHMENT_MAX_BYTES}
        onClick={() => { setUnit("GB"); setAmount("1"); setUnlimited(false); setNotice(""); }} className="min-h-11 sm:min-h-9">Restore default</Button>
    </div>
    {saved === null && !error ? <p role="status" className="text-xs text-muted-foreground">Loading attachment settings…</p> : null}
    {saved !== null && !valid ? <p role="alert" className="text-xs text-destructive">Enter a positive file size, or choose Unlimited.</p> : null}
    {error ? <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-xs text-destructive">{error}</p>
      {saved === null ? <Button type="button" variant="outline" onClick={() => setReload(value => value + 1)}>Retry</Button> : null}
    </div> : null}
    <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{notice}</p>
  </div>;
}
