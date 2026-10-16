"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ModelPicker } from "@/components/model-picker";
import { ModelOptionsMenu } from "@/components/model-options-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { defaultParamsForModel } from "@/lib/model-params";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/components/settings-panel";
import type { ProjectModelSettings } from "@/lib/project-model";

export function ProjectModelSelect({ id, value, onChange, disabled }: {
  id: string; value: ProjectModelSettings; onChange: (value: ProjectModelSettings) => void | Promise<void>; disabled?: boolean;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [preferredId, setPreferredId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoaded(false); setError("");
    fetch("/api/models", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.models)) throw new Error("Could not load models.");
      if (!controller.signal.aborted) { setModels(body.models); setPreferredId(body.defaultModelId || ""); setLoaded(true); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load models."); });
    fetch("/api/preferences", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const data = await response.json(); const body = data.settings || {};
      if (!controller.signal.aborted) { setFavorites(body.favoriteModelKeys || []); if (body.modelId) setPreferredId(body.modelId); }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [retry]);
  const rememberedId = value.defaultModelEnabled || models.some(m => m.id === value.defaultModelId) ? value.defaultModelId : undefined;
  const modelId = rememberedId || (models.some(m => m.id === preferredId) ? preferredId : models[0]?.id) || "";
  const model = models.find(m => m.id === modelId);
  const params = value.defaultModelId === modelId ? value.defaultModelParams || [] : model ? defaultParamsForModel(model) : [];
  const blocked = disabled || saving;
  async function change(next: ProjectModelSettings) {
    if (blocked) return;
    setSaving(true); setError("");
    try { await onChange(next); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the default model."); }
    finally { setSaving(false); }
  }
  function toggleFavorite(key: string) {
    const next = favorites.includes(key) ? favorites.filter(k => k !== key) : [...favorites, key].slice(-100);
    setFavorites(next);
    void fetch("/api/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favoriteModelKeys: next }) });
  }
  return <div className="grid gap-3">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">Use project default model</label>
        <p id={id + "-description"} className="mt-1 text-xs leading-5 text-muted-foreground">Set the model and its options for every agent chat in this project.</p>
      </div>
      <Switch id={id} checked={value.defaultModelEnabled === true} disabled={blocked || (!value.defaultModelEnabled && !model)}
        aria-describedby={id + "-description"} className="mt-0.5 shrink-0"
        onCheckedChange={enabled => void change(enabled ? { defaultModelEnabled: true, defaultModelId: modelId, defaultModelParams: params } : { defaultModelEnabled: false })}/>
    </div>
    {value.defaultModelEnabled ? <div className="flex min-w-0 items-center gap-1">
      <ModelPicker models={models} value={modelId} onValueChange={next => void change({ defaultModelEnabled: true, defaultModelId: next, defaultModelParams: defaultParamsForModel(models.find(m => m.id === next)!) })}
        favoriteModelKeys={favorites} onToggleFavorite={toggleFavorite} disabled={blocked} className="min-w-0 flex-1"
        ariaLabel="Project default model" placeholder={loaded ? "Selected model is unavailable" : "Loading models…"}/>
      {model ? <ModelOptionsMenu model={model} modelParams={params} onModelParamsChange={next => void change({ defaultModelEnabled: true, defaultModelId: modelId, defaultModelParams: next })} disabled={blocked}/> : null}
    </div> : null}
    {!loaded && !error ? <p role="status" className="text-xs text-muted-foreground">Loading models…</p> : null}
    {loaded && !models.length ? <p className="text-xs text-muted-foreground">Connect a provider and refresh models in Settings.</p> : null}
    {value.defaultModelEnabled && loaded && !model ? <p role="alert" className="text-xs text-destructive">The selected model is unavailable. Choose another model or turn off the project default.</p> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error} {!loaded ? <button type="button" className="underline" onClick={() => setRetry(count => count + 1)}>Retry</button> : null}</p> : null}
  </div>;
}

export function ProjectModelLock({ message, children, className }: { message: string; children: ReactNode; className?: string }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <span tabIndex={0} role="group" aria-label={message} title={message}
      className={cn("cursor-not-allowed rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>{children}</span>
  </TooltipTrigger><TooltipContent side="top">{message}</TooltipContent></Tooltip></TooltipProvider>;
}
