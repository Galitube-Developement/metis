"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { NotificationPrefs } from "@/lib/notification-store";

type Client = { id: string; name: string; status: string; nativeNotifications: boolean | null };
export function NotificationDeliverySettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("Metis");
  const [body, setBody] = useState("Your notification settings are ready.");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/notifications", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load notifications.");
      if (!controller.signal.aborted) { setPrefs(data.prefs); setClients(data.clients); setError(""); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [reload]);
  async function save(patch: Partial<NotificationPrefs>) {
    if (!prefs || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (patch.browserEnabled && (!("Notification" in window) || await Notification.requestPermission() !== "granted")) throw new Error("Allow notifications in this browser first.");
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save notifications.");
      setPrefs(data.prefs); setNotice("Saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save notifications."); }
    finally { setBusy(false); }
  }
  async function send() {
    if (busy || !title.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send notification.");
      setNotice("Notification queued for your enabled channels.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send notification."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4" aria-label="Notification delivery">
    {!prefs && !error ? <p role="status" className="text-xs text-muted-foreground">Loading notification settings…</p> : null}
    {prefs ? <>
      <div className="flex items-center justify-between gap-4">
        <div><label htmlFor="notification-toast" className="text-sm">In-app toasts</label><p className="mt-1 text-xs text-muted-foreground">Messages at the top of this workspace.</p></div>
        <Switch id="notification-toast" checked={prefs.toastEnabled} disabled={busy} onCheckedChange={toastEnabled => void save({ toastEnabled })} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div><label htmlFor="notification-browser" className="text-sm">Browser push</label><p className="mt-1 text-xs text-muted-foreground">System alerts while Metis is open in your browser.</p></div>
        <Switch id="notification-browser" checked={prefs.browserEnabled} disabled={busy || typeof window === "undefined" || !("Notification" in window)} onCheckedChange={browserEnabled => void save({ browserEnabled })} />
      </div>
      <div className="space-y-2 border-t border-border/60 pt-3">
        <p className="text-sm">Remote Client push</p>
        <p className="text-xs text-muted-foreground">Choose devices for native alerts, even when the browser is closed.</p>
        {clients.filter(client => client.status !== "revoked").map(client => <div key={client.id} className="flex items-center justify-between gap-4">
          <div className="min-w-0"><label htmlFor={"notify-device-" + client.id} className="text-xs">{client.name}</label><p className="text-xs text-muted-foreground">{client.status === "offline" ? "Offline · delivery waits for reconnection" : client.nativeNotifications ? "Native notifications available" : "Update and connect the desktop client to enable native alerts"}</p></div>
          <Switch id={"notify-device-" + client.id} checked={prefs.remoteClientIds.includes(client.id)} disabled={busy || (client.status === "online" && !client.nativeNotifications)} onCheckedChange={checked => void save({ remoteClientIds: checked ? [...prefs.remoteClientIds, client.id] : prefs.remoteClientIds.filter(id => id !== client.id) })} />
        </div>)}
        {!clients.some(client => client.status !== "revoked") ? <p className="text-xs text-muted-foreground">Connect a Remote Client to select a device.</p> : null}
      </div>
      <details className="border-t border-border/60 pt-3">
        <summary className="cursor-pointer text-xs">Send a custom notification</summary>
        <div className="mt-3 space-y-2">
          <label htmlFor="custom-notification-title" className="text-xs">Title</label>
          <Input id="custom-notification-title" maxLength={160} value={title} onChange={event => setTitle(event.target.value)} />
          <label htmlFor="custom-notification-body" className="text-xs">Message</label>
          <Input id="custom-notification-body" maxLength={2000} value={body} onChange={event => setBody(event.target.value)} />
          <Button disabled={busy || !title.trim()} onClick={() => void send()}>Send notification</Button>
        </div>
      </details>
    </> : null}
    {error ? <div className="space-y-2"><p role="alert" className="text-xs text-destructive">{error}</p>{!prefs ? <Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry</Button> : null}</div> : null}
    {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
  </div>;
}
