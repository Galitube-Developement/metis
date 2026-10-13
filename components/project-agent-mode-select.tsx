"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentMode } from "@/lib/store";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ProjectAgentModeSelect({ id, value, onChange, disabled }: {
  id: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [modes, setModes] = useState<AgentMode[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    fetch("/api/modes", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.modes)) throw new Error("Could not load agents.");
      if (!cancelled) setModes(body.modes);
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load agents."); });
    return () => { cancelled = true; };
  }, [retry]);
  return <div className="grid gap-2">
    <label htmlFor={id} className="text-sm font-medium">Default agent</label>
    <select id={id} value={value} disabled={disabled || !modes.length}
      aria-describedby={id + "-description"}
      onChange={event => onChange(event.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {!modes.some(mode => mode.id === value) ? <option value={value}>{modes.length ? "Selected agent is unavailable" : "Loading agents…"}</option> : null}
      {modes.map(mode => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
    </select>
    <p id={id + "-description"} className="text-xs leading-5 text-muted-foreground">Applies to every agent chat in this project. Change the agent here instead of in individual chats.</p>
    {error ? <p role="alert" className="text-xs text-destructive">{error} <button type="button" className="underline" onClick={() => setRetry(count => count + 1)}>Retry</button></p> : null}
  </div>;
}

export function ProjectAgentModeLock({ message, name, children, className }: {
  message: string; name: string; children: ReactNode; className?: string;
}) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <span tabIndex={0} role="group" aria-label={`Agent mode: ${name}. ${message}`} title={message}
      className={cn("cursor-not-allowed rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      {children}
    </span>
  </TooltipTrigger><TooltipContent side="top">{message}</TooltipContent></Tooltip></TooltipProvider>;
}
