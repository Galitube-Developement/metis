"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker } from "@/components/model-picker";
import { TeamAgentAvatar } from "@/components/team-agent-avatar";
import type { ModelInfo } from "@/components/settings-panel";
import { TEAM_DRAFT_LIMIT, validateTeamDraft, type TeamDraft, type TeamDraftAgent, type TeamGeneration, type TeamPreset } from "@/lib/team-preset-types";

const GENERATION_KEY = "metis-team-preset-generation";
async function request(url: string, init?: RequestInit) {
 const response = await fetch(url, { cache: "no-store", ...init });
 const body = await response.json();
 if (!response.ok) throw new Error(body.error || "Request failed. Please try again.");
 return body;
}
const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function TeamPresetDialog({ open, onOpenChange, projectId, onUse, useLabel = "Use this team", startWithAI = false, initialDraft }: {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 projectId?: string;
 onUse?: (draft: TeamDraft) => Promise<void> | void;
 useLabel?: string;
 startWithAI?: boolean;
 initialDraft?: TeamDraft;
}) {
 const [view, setView] = useState<"library" | "generate" | "review">("library");
 const [presets, setPresets] = useState<TeamPreset[]>([]);
 const [draft, setDraft] = useState<TeamDraft | null>(null);
 const [selectedId, setSelectedId] = useState<string | null>(null);
 const [models, setModels] = useState<ModelInfo[]>([]);
 const [modelId, setModelId] = useState("");
 const [favorites, setFavorites] = useState<string[]>([]);
 const [prompt, setPrompt] = useState("");
 const [generation, setGeneration] = useState<TeamGeneration | null>(null);
 const [busy, setBusy] = useState(false);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const [notice, setNotice] = useState("");
 const [deleting, setDeleting] = useState<TeamPreset | null>(null);
 const handledGeneration = useRef<string | null>(null);
 const running = generation?.status === "queued" || generation?.status === "running";
 const loadPresets = useCallback(async () => {
  const body = await request("/api/team-presets");
  setPresets(body.presets || []);
 }, []);
 useEffect(() => {
  if (!open) return;
  let cancelled = false;
  setError(""); setNotice(""); setDeleting(null);
  if (initialDraft) { setDraft(initialDraft); setSelectedId(null); }
  setView(initialDraft ? "review" : startWithAI ? "generate" : "library");
  setLoading(true);
  void loadPresets().catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
  const id = sessionStorage.getItem(GENERATION_KEY);
  if (id) void request("/api/team-presets/generate?id=" + encodeURIComponent(id)).then(body => {
   if (!cancelled) setGeneration(body.generation);
  }).catch(() => { sessionStorage.removeItem(GENERATION_KEY); });
  return () => { cancelled = true; };
 }, [open, loadPresets, startWithAI, initialDraft]);
 useEffect(() => {
  if (!open || view !== "generate") return;
  let cancelled = false;
  void request("/api/models").then(body => {
   if (cancelled) return;
   const available: ModelInfo[] = body.models || [];
   setModels(available);
   setModelId(current => available.some(m => m.id === current) ? current : "");
  }).catch(e => { if (!cancelled) setError(e.message); });
  return () => { cancelled = true; };
 }, [open, view]);
 useEffect(() => {
  if (!open || !generation) return;
  if (generation.status === "ready" && generation.draft && handledGeneration.current !== generation.id) {
   handledGeneration.current = generation.id;
   sessionStorage.removeItem(GENERATION_KEY);
   setDraft(generation.draft); setSelectedId(null); setView("review"); setError("");
   setNotice("AI draft ready. Review each agent before importing.");
  } else if (generation.status === "error" || generation.status === "cancelled") {
   sessionStorage.removeItem(GENERATION_KEY);
   setError(generation.error || "Generation cancelled. No agents were created.");
  }
 }, [open, generation]);
 useEffect(() => {
  if (!open || !running || !generation) return;
  let cancelled = false;
  const poll = async () => {
   try { const body = await request("/api/team-presets/generate?id=" + encodeURIComponent(generation.id)); if (!cancelled) { setGeneration(body.generation); setError(""); } }
   catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not check generation. Reopen presets to retry."); }
  };
  const timer = window.setInterval(() => void poll(), 1500);
  return () => { cancelled = true; window.clearInterval(timer); };
 }, [open, running, generation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

 async function act(operation: () => Promise<void>) {
  setBusy(true); setError(""); setNotice("");
  try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); } finally { setBusy(false); }
 }
 function choose(preset: TeamPreset) {
  setDraft({ name: preset.name, description: preset.description, agents: preset.agents.map(a => ({ ...a })) });
  setSelectedId(preset.builtIn ? null : preset.id); setView("review"); setError(""); setNotice("");
 }
 function patch(key: string, fields: Partial<TeamDraftAgent>) {
  setDraft(current => current ? { ...current, agents: current.agents.map(a => a.key === key ? { ...a, ...fields } : a) } : current);
 }
 function remove(key: string) {
  setDraft(current => current ? { ...current, agents: current.agents.filter(a => a.key !== key).map(a => a.supervisorKey === key ? { ...a, supervisorKey: undefined } : a) } : current);
 }
 async function save(copy = false) {
  if (!draft) return;
  const cleaned = validateTeamDraft(draft);
  const body = await request(selectedId && !copy ? "/api/team-presets/" + selectedId : "/api/team-presets", json(cleaned, selectedId && !copy ? "PATCH" : "POST"));
  setSelectedId(body.preset.id); await loadPresets();
  window.dispatchEvent(new Event("metis:team-presets-changed"));
  setNotice("Preset saved in Projects → Team presets.");
 }
 return <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="flex max-h-[90dvh] flex-col gap-4 overflow-hidden sm:max-w-3xl" data-slot="team-preset-dialog">
   <DialogHeader><DialogTitle>{view === "generate" ? "Make a preset with AI" : view === "review" ? "Review your team" : "Team presets"}</DialogTitle><DialogDescription>{view === "review" ? "Edit roles, prompts and relationships. Nothing runs until you import and message an agent." : "Build a team, review it, and save a reusable preset for your projects."}</DialogDescription></DialogHeader>
   <div className="flex shrink-0 flex-wrap gap-2">
    <Button variant={view === "library" ? "secondary" : "ghost"} size="sm" onClick={() => { setView("library"); setError(""); }}>Saved presets</Button>
    <Button variant={view === "generate" ? "secondary" : "ghost"} size="sm" onClick={() => { setView("generate"); setError(""); }}><Sparkles className="size-3.5"/>Make a preset with AI</Button>
    {projectId ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(async () => {
     const body = await request("/api/team-presets?projectId=" + encodeURIComponent(projectId));
     setDraft(body.draft); setSelectedId(null); setView("review");
    })}>Save current team</Button> : null}
    {draft && view !== "review" ? <Button variant="ghost" size="sm" onClick={() => setView("review")}>Back to draft</Button> : null}
   </div>
   <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
    {view === "library" ? <div>
     {loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading presets…</p> : <ul className="divide-y divide-border/60">{presets.map(p => <li key={p.id} className="flex items-center gap-3 py-3">
      <button className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => choose(p)}>
       <span className="flex shrink-0 -space-x-2" aria-hidden="true">{p.agents.slice(0, 3).map(a => <TeamAgentAvatar key={a.key} name={a.name} color={a.color} decorative className="size-8 ring-2 ring-background"/>)}</span>
       <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.agents.length} agents · {p.builtIn ? "Metis preset" : "Your preset"}</span><span className="block truncate text-xs text-muted-foreground">{p.description}</span></span>
      </button>
      {!p.builtIn ? <Button variant="ghost" size="icon-sm" aria-label={`Delete preset ${p.name}`} onClick={() => setDeleting(p)}><Trash2 className="size-4"/></Button> : null}
     </li>)}</ul>}
     {!loading && presets.every(p => p.builtIn) ? <p className="mt-4 text-sm text-muted-foreground">Your saved teams will appear here. Start from the Metis team or describe a team to AI.</p> : null}
    </div> : view === "generate" ? <div className="grid grid-cols-1 gap-4">
     <label className="grid gap-2 text-sm">Describe your team<Textarea className="min-w-0 [field-sizing:fixed]" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={12000} rows={5} placeholder="A product launch team: a coordinator, a market researcher, a copywriter and a reviewer…"/></label>
     <div className="grid gap-2"><span className="text-sm">Model for this draft</span><ModelPicker models={models} value={modelId} onValueChange={setModelId} favoriteModelKeys={favorites} onToggleFavorite={id => setFavorites(current => current.includes(id) ? current.filter(key => key !== id) : [...current, id])} disabled={running || busy} ariaLabel="Team generation model"/></div>
     {!models.length ? <p className="text-xs text-muted-foreground">Available models come from your connected providers in Settings.</p> : null}
     <div className="flex flex-wrap items-center gap-2">
      <Button disabled={running || busy || !prompt.trim() || !modelId} onClick={() => void act(async () => {
       const body = await request("/api/team-presets/generate", json({ prompt, modelId }));
       handledGeneration.current = null; setGeneration(body.generation); sessionStorage.setItem(GENERATION_KEY, body.generation.id);
      })}><Sparkles className="size-4"/>{busy ? "Starting…" : "Generate team"}</Button>
      {running ? <><p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none"/>{generation?.status === "queued" ? "Queued" : "Designing your team…"}</p><Button variant="outline" disabled={busy} onClick={() => void act(async () => { const body = await request("/api/team-presets/generate", json({ action: "cancel", id: generation?.id })); setGeneration(body.generation); })}>Stop generation</Button></> : null}
     </div><p className="text-xs text-muted-foreground">Uses your chosen provider. The response becomes an editable draft; agents are created only after review.</p>
    </div> : draft ? <div className="grid grid-cols-1 gap-4">
     <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">Preset name<Input value={draft.name} maxLength={120} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label><label className="grid gap-1.5 text-sm">Description<Input value={draft.description} maxLength={1000} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label></div>
     <div className="flex items-center justify-between"><h3 className="text-sm font-medium">{draft.agents.length} agents to review</h3><Button variant="ghost" size="sm" disabled={draft.agents.length >= TEAM_DRAFT_LIMIT} onClick={() => setDraft({ ...draft, agents: [...draft.agents, { key: crypto.randomUUID(), name: "New agent", role: "", systemPrompt: "", color: "#1767ed" }] })}><Plus className="size-3.5"/>Add agent</Button></div>
     <div className="divide-y divide-border/60">{draft.agents.map((a, index) => <details key={a.key} open={index === 0 ? true : undefined} className="py-3" data-agent-key={a.key}>
      <summary className="flex cursor-pointer items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
       <TeamAgentAvatar name={a.name} color={a.color} className="size-9"/>
       <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.name || "Unnamed agent"}</span><span className="block truncate text-xs text-muted-foreground">{a.role || "Add a role"}{a.supervisorKey ? ` · Reports to ${draft.agents.find(s => s.key === a.supervisorKey)?.name || "missing supervisor"}` : ""}</span></span>
       <span className="text-xs text-muted-foreground">Edit</span>
      </summary>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 pl-0 sm:pl-12">
       <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">Agent name<Input value={a.name} maxLength={120} onChange={e => patch(a.key, { name: e.target.value })}/></label><label className="grid gap-1.5 text-sm">Role<Input value={a.role} maxLength={120} onChange={e => patch(a.key, { role: e.target.value })}/></label></div>
       <label className="grid gap-1.5 text-sm">System prompt<Textarea className="min-w-0 [field-sizing:fixed]" value={a.systemPrompt} maxLength={20000} rows={4} onChange={e => patch(a.key, { systemPrompt: e.target.value })}/></label>
       <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1.5 text-sm">Avatar color<input type="color" value={a.color} aria-label={`Avatar color for ${a.name}`} className="h-9 w-12 rounded border border-input bg-background" onChange={e => patch(a.key, { color: e.target.value })}/></label>
        <label className="grid min-w-0 flex-1 gap-1.5 text-sm">Supervising agent<select value={a.supervisorKey || ""} onChange={e => patch(a.key, { supervisorKey: e.target.value || undefined })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">No supervisor</option>{draft.agents.filter(s => s.key !== a.key).map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
        <Button variant="ghost" size="sm" aria-label={`Remove ${a.name} from draft`} onClick={() => remove(a.key)}><Trash2 className="size-3.5"/>Remove</Button>
       </div>
      </div>
     </details>)}</div>
    </div> : null}
    {deleting ? <div role="alert" className="mt-4 border-t border-border pt-3"><p className="text-sm">Delete “{deleting.name}” from saved presets? Existing teams stay intact.</p><div className="mt-2 flex gap-2"><Button variant="outline" size="sm" onClick={() => setDeleting(null)}>Keep preset</Button><Button variant="destructive" size="sm" disabled={busy} onClick={() => void act(async () => { await request("/api/team-presets/" + deleting.id, { method: "DELETE" }); setDeleting(null); await loadPresets(); setNotice("Preset deleted. Existing agents are unchanged."); })}>Delete preset</Button></div></div> : null}
   </div>
   {running && view !== "generate" ? <button onClick={() => setView("generate")} className="text-left text-xs text-muted-foreground underline">AI generation is {generation?.status}. View progress or stop.</button> : null}
   {error ? <p role="alert" className="shrink-0 text-sm text-destructive">{error}</p> : null}
   {notice ? <p role="status" className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground"><Check className="size-4"/>{notice}</p> : null}
   <DialogFooter className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap">
    <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
    {view === "review" && draft ? <>
     <Button variant="outline" disabled={busy || !draft.agents.length} onClick={() => void act(() => save())}><Save className="size-4"/>{selectedId ? "Update preset" : "Save preset"}</Button>
     {selectedId ? <Button variant="outline" disabled={busy || !draft.agents.length} onClick={() => void act(() => save(true))}>Save as new</Button> : null}
     {onUse ? <Button disabled={busy || !draft.agents.length} onClick={() => void act(async () => { await onUse(validateTeamDraft(draft)); onOpenChange(false); })}>{busy ? "Working…" : useLabel}</Button> : null}
    </> : null}
   </DialogFooter>
  </DialogContent>
 </Dialog>;
}
