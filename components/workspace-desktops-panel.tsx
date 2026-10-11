"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Monitor, Pause, Play, RefreshCw, Settings2, Upload } from "lucide-react";
import { FileDropZone } from "@/components/file-drop-zone";
import { startUpload } from "@/lib/background-uploads";
import { toast } from "sonner";
import { MAX_ATTACHMENTS, MAX_FILE_BYTES } from "@/lib/upload-limits";
import { Button } from "@/components/ui/button";
import { notifyClientError } from "@/lib/client-error-notifications";
import { chooseDesktopClient, desktopUnavailableReason } from "@/lib/remote-desktop-view";
import type { RemoteClient } from "@/lib/remote-clients";

async function responseError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  return typeof data?.error === "string" ? data.error : fallback;
}

export function WorkspaceDesktopsPanel({ active, agentClientId, agentActive, activityTimestamp, onOpenDevices }: {
  active: boolean; agentClientId?: string | null; agentActive?: boolean; activityTimestamp?: number; onOpenDevices: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [clients, setClients] = useState<RemoteClient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
  const [paused, setPaused] = useState(false);
  const [frame, setFrame] = useState<{ url: string; at: number } | null>(null);
  const [frameError, setFrameError] = useState("");
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry(value => value + 1), []);

  useEffect(() => {
    if (!active) return;
    let disposed = false, controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (disposed || document.hidden) return;
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const response = await fetch("/api/remote-clients", { signal: requestController.signal, cache: "no-store" });
        if (!response.ok) throw new Error(await responseError(response, "Could not load Remote Devices"));
        const data = await response.json();
        if (!disposed) { setClients(data.clients || []); setInventoryError(""); setLoading(false); }
      } catch (error) {
        if (disposed || requestController.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Could not load Remote Devices";
        setInventoryError(message); setLoading(false);
        notifyClientError(error, { title: "Remote Devices unavailable", key: "desktop-inventory" });
      } finally { if (!disposed && controller === requestController && !requestController.signal.aborted && !document.hidden) timer = setTimeout(load, 5000); }
    };
    const visibility = () => { clearTimeout(timer); controller?.abort(); if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [active, retry]);

  // Follow only a new, running desktop tool; choosing another device stays possible afterwards.
  useEffect(() => { if (agentClientId) { setSelectedId(agentClientId); setPaused(false); } }, [agentClientId, activityTimestamp]);
  const selected = chooseDesktopClient(clients, selectedId);
  const unavailable = selected ? desktopUnavailableReason(selected) : null;
  const deviceId = selected?.id ?? null;

  useEffect(() => {
    setFrame(null); setFrameError("");
    if (!active || !deviceId || unavailable || paused || inventoryError) return;
    let disposed = false, stopped = false, objectUrl: string | null = null;
    let controller: AbortController | null = null, timer: ReturnType<typeof setTimeout>;
    const capture = async () => {
      if (disposed || stopped || document.hidden) return;
      const requestController = new AbortController();
      controller = requestController;
      try {
        const response = await fetch("/api/remote-clients/" + encodeURIComponent(deviceId) + "/desktop",
          { method: "POST", signal: requestController.signal, cache: "no-store" });
        if (!response.ok) throw new Error(await responseError(response, "Desktop preview failed"));
        const blob = await response.blob();
        if (disposed || requestController.signal.aborted) return;
        const next = URL.createObjectURL(blob), previous = objectUrl;
        objectUrl = next;
        const capturedAt = Number(response.headers.get("X-Desktop-Captured-At"));
        setFrame({ url: next, at: Number.isFinite(capturedAt) && capturedAt > 0 ? capturedAt : Date.now() });
        if (previous) URL.revokeObjectURL(previous);
      } catch (error) {
        if (disposed || requestController.signal.aborted) return;
        stopped = true; setFrame(null);
        const message = error instanceof Error ? error.message : "Desktop preview failed";
        setFrameError(message);
        notifyClientError(error, { title: "Desktop preview failed", key: "desktop-frame:" + deviceId });
      } finally {
        if (!disposed && controller === requestController && !requestController.signal.aborted && !stopped && !document.hidden) timer = setTimeout(capture, 1000);
      }
    };
    const visibility = () => {
      clearTimeout(timer); controller?.abort(); setFrame(null);
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      if (!document.hidden) void capture();
    };
    document.addEventListener("visibilitychange", visibility);
    void capture();
    return () => {
      disposed = true; clearTimeout(timer); controller?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, deviceId, unavailable, paused, retry, inventoryError]);

  const transferReady = active && selected?.status === "online" && selected.policy.mode === "full_access" && !inventoryError;
  function uploadFiles(files: FileList) {
    if (!transferReady || !selected) { toast.error("Select an online Remote Device with Full access to transfer files."); return; }
    const incoming = Array.from(files), targetId = selected.id, targetName = selected.name || selected.hostname || "Remote Device";
    if (!incoming.length || incoming.length > MAX_ATTACHMENTS || incoming.some(file => !file.size || file.size > MAX_FILE_BYTES)) {
      toast.error("Choose up to 10 files, each 1 GB or smaller."); return;
    }
    for (const file of incoming) startUpload(file, { label: targetName + " · Desktop", onComplete: async upload => {
      const response = await fetch("/api/remote-clients/" + encodeURIComponent(targetId) + "/files", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId: upload.id }),
      });
      if (!response.ok) throw new Error(await responseError(response, "File transfer failed"));
      const result = await response.json();
      toast.success("File saved on " + targetName, { description: result.path });
    } });
  }

  const error = inventoryError || unavailable || frameError;
  return <FileDropZone className="relative flex min-h-0 flex-1 flex-col gap-2" enabled={Boolean(transferReady)}
    title={"Drop files onto " + (selected?.name || "this desktop")} detail="Files are saved in this device’s Desktop folder." onFiles={uploadFiles}>
    <input ref={fileInputRef} type="file" multiple className="hidden" aria-label="Upload files to remote desktop" onChange={event => {
      if (event.target.files?.length) uploadFiles(event.target.files); event.target.value = "";
    }} />
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <select aria-label="Select remote desktop" value={deviceId || ""} disabled={loading || clients.length === 0}
        onChange={event => { setSelectedId(event.target.value); setPaused(false); }}
        className="h-9 min-w-0 flex-1 rounded-md border border-border/50 bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
        {!clients.length && <option value="">{loading ? "Loading devices…" : "No Remote Devices"}</option>}
        {clients.map(client => <option key={client.id} value={client.id}>{client.name || client.hostname || client.id} · {client.status}</option>)}
      </select>
      <Button size="icon-sm" variant="ghost" className="size-9" aria-label={paused ? "Resume desktop preview" : "Pause desktop preview"}
        disabled={!selected || Boolean(unavailable)} onClick={() => setPaused(value => !value)}>
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      </Button>
      <Button size="icon-sm" variant="ghost" className="size-9" aria-label="Upload files to remote desktop" title={transferReady ? "Save files to Desktop" : "File transfer requires an online device with Full access"}
        disabled={!transferReady} onClick={() => fileInputRef.current?.click()}><Upload className="size-4" /></Button>
      <Button size="icon-sm" variant="ghost" className="size-9" aria-label="Refresh remote desktops" onClick={refresh}><RefreshCw className="size-4" /></Button>
      <Button size="icon-sm" variant="ghost" className="size-9" aria-label="Manage Remote Devices" onClick={onOpenDevices}><Settings2 className="size-4" /></Button>
    </div>
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-muted/20">
      {error ? <div className="max-w-sm space-y-3 p-6 text-center">
        <p className={inventoryError || frameError ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role={inventoryError || frameError ? "alert" : "status"}>{error}</p>
        {frameError || inventoryError ? <Button size="sm" variant="outline" onClick={refresh}>Try again</Button> : null}
      </div> : !loading && !selected ? <div className="space-y-3 p-6 text-center">
        <Monitor className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm">No Remote Devices connected</p>
        <p className="max-w-xs text-xs text-muted-foreground">Add a Remote Client to view its desktop here.</p>
        <Button size="sm" variant="outline" onClick={onOpenDevices}>Add Remote Device</Button>
      </div> : paused ? <p className="p-6 text-sm text-muted-foreground" role="status">Desktop preview paused</p>
        // Blob frames already arrive bounded and optimized by the capture endpoint.
        // eslint-disable-next-line @next/next/no-img-element
        : frame ? <img src={frame.url} alt={"Live desktop of " + (selected?.name || "Remote Client")} className="size-full object-contain" />
        : <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" />{loading ? "Loading Remote Devices…" : "Connecting to desktop…"}</div>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span>{frame && !error && !paused ? "Live · " + new Date(frame.at).toLocaleTimeString() : selected?.hostname || "Remote Devices"}</span>
      <span>{agentActive && agentClientId === deviceId ? "Agent is using this desktop" : "View only · primary display"}</span>
    </div>
  </FileDropZone>;
}
