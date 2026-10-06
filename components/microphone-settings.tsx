"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MICROPHONE_STORAGE_KEY, microphoneInputs, readLocalMicrophone, saveLocalMicrophone } from "@/lib/local-microphone";

export function MicrophoneSettings({ browserTranscription = false }: { browserTranscription?: boolean }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const inputs = microphoneInputs(await navigator.mediaDevices.enumerateDevices());
      if (mounted.current && request === generation.current) {
        setDevices(inputs);
        setLoaded(true);
        setError("");
      }
    } catch {
      if (mounted.current && request === generation.current) {
        setError("Could not list microphones. Check microphone access in your browser and try again.");
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setSelected(readLocalMicrophone());
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices || !media.getUserMedia) {
      setSupported(false);
      setLoaded(true);
      return () => { mounted.current = false; };
    }
    void refresh();
    const syncSelection = (event: StorageEvent) => {
      if (event.key === MICROPHONE_STORAGE_KEY || event.key === null) setSelected(readLocalMicrophone());
    };
    media.addEventListener("devicechange", refresh);
    window.addEventListener("storage", syncSelection);
    return () => {
      mounted.current = false;
      ++generation.current;
      media.removeEventListener("devicechange", refresh);
      window.removeEventListener("storage", syncSelection);
    };
  }, [refresh]);

  async function allowAccess() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      if (mounted.current) await refresh();
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error && ["NotAllowedError", "SecurityError"].includes(cause.name)
          ? "Microphone access was denied. Allow access in your browser settings, then try again."
          : "Could not access a microphone. Connect one and try again.");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const missing = loaded && selected && !devices.some(device => device.deviceId === selected);
  const needsPermission = !devices.length || devices.some(device => !device.label);

  return (
    <div className="flex flex-col gap-2">
      <label className="grid gap-1 text-xs text-muted-foreground">
        Microphone
        <select
          aria-label="Microphone"
          value={selected}
          disabled={!loaded || !supported || busy || browserTranscription}
          onChange={event => {
            try {
              saveLocalMicrophone(event.target.value);
              setSelected(event.target.value);
              setError("");
            } catch {
              setError("Could not save the microphone on this device. Allow local browser storage and try again.");
            }
          }}
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="">System default</option>
          {missing ? <option value={selected}>Selected microphone (unavailable)</option> : null}
          {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone " + (index + 1)}</option>)}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">Saved only in this browser on this device, across accounts. Other devices keep their own selection.</p>
      {browserTranscription ? <p className="text-xs text-muted-foreground">Browser transcription uses the system default microphone. Device selection is available with the other transcription providers.</p> : null}
      {!supported ? <p role="status" className="text-xs text-muted-foreground">Microphone selection requires a supported browser and a secure connection.</p> : null}
      {!loaded ? <p role="status" className="text-xs text-muted-foreground">Loading microphones…</p> : null}
      {supported && loaded && !devices.length ? <p className="text-xs text-muted-foreground">No microphone devices are visible yet. Connect a microphone or allow access to show available devices.</p> : null}
      {missing ? <p role="status" className="text-xs text-muted-foreground">Your saved microphone is unavailable. Reconnect it or choose another input before recording.</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {supported ? <div className="flex flex-wrap gap-2">
        {needsPermission ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void allowAccess()}>{busy ? "Requesting access…" : "Allow microphone access"}</Button> : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy || !loaded} onClick={() => void refresh()}>Refresh devices</Button>
      </div> : null}
    </div>
  );
}
