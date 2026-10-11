"use client";
import { useEffect, useState } from "react";
import { RunStatus } from "./run-status";

/** Elapsed time remains honest when a provider buffers its next tool or text update. */
export function AgentActivity({ activityKey, label }: { activityKey: string; label?: string }) {
  const [clock, setClock] = useState(() => ({ key: activityKey, since: Date.now(), now: Date.now() }));
  if (clock.key !== activityKey) setClock({ key: activityKey, since: Date.now(), now: Date.now() });
  useEffect(() => {
    const timer = window.setInterval(() => setClock(current => ({ ...current, now: Date.now() })), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((clock.now - clock.since) / 1000));
  return <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" aria-label="Agent working" data-agent-activity>
    <RunStatus status="running" iconOnly decorative className="shrink-0 text-xs"/>
    <span className="min-w-0 truncate">{label || "Preparing next action"}</span>
    {elapsed >= 3 ? <span className="shrink-0 tabular-nums" aria-hidden="true">· {elapsed}s</span> : null}
  </span>;
}
