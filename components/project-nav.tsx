"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FolderPlus, Plus, Sparkles } from "lucide-react";
import { ProjectAvatar, ProjectIconGlyph } from "@/components/project-avatar";
import { TeamPresetDialog } from "@/components/team-preset-dialog";
import type { TeamDraft, TeamPreset } from "@/lib/team-preset-types";
import { ProjectAgentNav } from "@/components/project-agents-panel";
import type { ProjectAgent } from "@/lib/project-team-types";
import { Button } from "@/components/ui/button";
import {
 Dialog,
 DialogContent,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PROJECT_COLORS, PROJECT_ICONS } from "@/lib/project-constants";
import { cn } from "@/lib/utils";

export type SidebarProject = {
 id: string;
 name: string;
 mode?: "chat" | "agents";
 icon: string;
 color: string;
 logoStoredName?: string;
 updatedAt?: string;
};

export type SidebarChat = {
 id: string;
 title: string;
 projectId?: string;
 pinned?: boolean;
 archived?: boolean;
 incognito?: boolean;
};

const PROJECT_SYNC_INTERVAL_MS = 60_000;
let projectCache: SidebarProject[] | null = null;
let projectCacheAt = 0;
let projectRequest: Promise<SidebarProject[]> | null = null;

function loadProjectCache(force = false) {
 const now = Date.now();
 if (!force && projectCache && now - projectCacheAt < PROJECT_SYNC_INTERVAL_MS) {
  return Promise.resolve(projectCache);
 }
 if (!force && projectRequest) return projectRequest;
 projectRequest = fetch("/api/projects", { cache: "no-store" })
  .then(async (response) => {
   const body = (await response.json().catch(() => ({}))) as { projects?: SidebarProject[] };
   if (!response.ok) throw new Error("Could not load projects");
   projectCache = body.projects || [];
   projectCacheAt = Date.now();
   return projectCache;
  })
  .finally(() => {
   projectRequest = null;
  });
 return projectRequest;
}

export function ProjectNav({
 chats,
 activeChatId,
 activeProjectId,
 notesOpen,
 renderChat,
 renderAgentActions,
 onNewChat,
 onOpenAgentChat,
 onOpenProject,
 onClearProject,
 onMoveChat,
  onCollapseNav,
  onOverlayOpen,
}: {
 chats: SidebarChat[];
 activeChatId?: string | null;
 activeProjectId?: string | null;
 notesOpen?: boolean;
 renderChat: (chat: SidebarChat) => ReactNode;
 renderAgentActions?: (agent: ProjectAgent, agents: ProjectAgent[]) => ReactNode;
 onNewChat: (projectId?: string | null) => void;
 onOpenAgentChat: (chatId: string) => void;
 onOpenProject: (projectId: string) => void;
 onClearProject: () => void;
 onMoveChat: (chatId: string, projectId: string | null) => void;
  onCollapseNav?: () => void;
  onOverlayOpen?: () => void;
}) {
 const [projects, setProjects] = useState<SidebarProject[]>([]);
 const [createOpen, setCreateOpen] = useState(false);
 const [name, setName] = useState("");
 const [icon, setIcon] = useState<string>(PROJECT_ICONS[0]);
 const [color, setColor] = useState(PROJECT_COLORS[0]);
 const [agentMode, setAgentMode] = useState<"chat" | "agents">("chat");
 const [teamPreset, setTeamPreset] = useState("none");
 const [teamDraft, setTeamDraft] = useState<TeamDraft | null>(null);
 const [savedPresets, setSavedPresets] = useState<TeamPreset[]>([]);
 const [presetOpen, setPresetOpen] = useState(false);
 const [presetPurpose, setPresetPurpose] = useState<"library" | "select" | "ai">("library");
 useEffect(() => {
  if (!createOpen) return;
  let cancelled = false;
  const loadPresets = async () => {
   try { const response = await fetch("/api/team-presets", { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load presets"); if (!cancelled) setSavedPresets(body.presets || []); }
   catch (cause) { if (!cancelled) setCreateError(cause instanceof Error ? cause.message : "Could not load presets"); }
  };
  void loadPresets(); window.addEventListener("metis:team-presets-changed", loadPresets);
  return () => { cancelled = true; window.removeEventListener("metis:team-presets-changed", loadPresets); };
 }, [createOpen]);
 const [createError, setCreateError] = useState("");
 const [creating, setCreating] = useState(false);
 const [draggingId, setDraggingId] = useState<string | null>(null);

 const load = useCallback((force = false) => {
  void loadProjectCache(force)
   .then((next) => setProjects(next))
   .catch(() => undefined);
 }, []);

 useEffect(() => {
  load();
  const refresh = () => load(true);
  const timer = window.setInterval(() => load(), PROJECT_SYNC_INTERVAL_MS);
  window.addEventListener("metis:projects-changed", refresh);
  return () => {
   window.clearInterval(timer);
   window.removeEventListener("metis:projects-changed", refresh);
  };
 }, [load]);

 const visibleChats = useMemo(() => {
  return chats.filter((chat) => {
   if (chat.archived) return false;
   if (!activeProjectId) return true;
   return chat.projectId === activeProjectId;
  });
 }, [chats, activeProjectId]);

 async function create() {
  setCreating(true); setCreateError("");
  try {
   const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() || "New project", icon, color, mode: agentMode, teamPreset: agentMode === "agents" && teamPreset === "starter", ...(agentMode === "agents" && teamDraft ? { teamDraft } : {}) }) });
   const body = (await response.json()) as { project?: SidebarProject; error?: string };
   if (!response.ok || !body.project) throw new Error(body.error || "Could not create project.");
   setCreateOpen(false); setName(""); setAgentMode("chat"); setTeamPreset("none"); setTeamDraft(null); load(true);
   window.dispatchEvent(new Event("metis:projects-changed")); onOpenProject(body.project.id); onCollapseNav?.();
  } catch (cause) { setCreateError(cause instanceof Error ? cause.message : "Could not create project."); }
  finally { setCreating(false); }
 }

  function openCreate() {
    setCreateOpen(true);
  }

 function droppable(projectId: string | null, children: ReactNode, key?: string) {
  return (
   <div
    key={key}
    onDragOver={(event) => {
     if (draggingId) event.preventDefault();
    }}
    onDrop={(event) => {
     event.preventDefault();
     if (draggingId) onMoveChat(draggingId, projectId);
     setDraggingId(null);
    }}
   >
    {children}
   </div>
  );
 }

 const allSelected = !activeProjectId;

 return (
  <div className="space-y-3">
   <div className="flex items-center justify-between px-2.5">
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Projects</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6"
          aria-label="New project"
          onClick={() => {
            onOverlayOpen?.();
            openCreate();
          }}
        >
     <FolderPlus className="size-3.5" />
    </Button>
   </div>
   <div className="flex flex-wrap gap-1.5 px-1.5">
    {droppable(
     null,
     <button
      type="button"
      className={cn(
       "rounded-full px-2.5 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
       allSelected
        ? "bg-white/[0.10] text-foreground ring-1 ring-foreground/20"
        : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground",
      )}
      aria-pressed={allSelected}
      onClick={onClearProject}
     >
      All
     </button>,
    )}
    {projects.map((project) => {
     const selected = activeProjectId === project.id;
     return (
      <div key={project.id}>
      {droppable(
      project.id,
      <button
       type="button"
       className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[12px] transition-colors",
        selected
         ? "bg-white/[0.10] text-foreground ring-1 ring-foreground/20"
         : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground",
       )}
       aria-pressed={selected}
       onClick={() => onOpenProject(project.id)}
       title={project.name}
      >
       <ProjectAvatar
        id={project.id}
        icon={project.icon}
        color={project.color}
        hasLogo={Boolean(project.logoStoredName)}
        updatedAt={project.updatedAt}
        className="size-4 rounded-full"
       />
       <span className="min-w-0 truncate">{project.name}</span>
      </button>,
      )}
      </div>
     );
    })}
   </div>
   {activeProjectId && projects.find(p => p.id === activeProjectId)?.mode === "agents" ? <ProjectAgentNav projectId={activeProjectId} activeChatId={activeChatId} onOpenChat={onOpenAgentChat} pinnedChatIds={chats.filter(chat => chat.pinned).map(chat => chat.id)} renderActions={renderAgentActions}/> : droppable(
    activeProjectId || null,
    <div className="space-y-1">
     <div className="flex items-center justify-between px-2.5 pt-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
       {activeProjectId ? projects.find((project) => project.id === activeProjectId)?.name || "Chats" : "Chats"}
      </p>
      <Button
       type="button"
       variant="ghost"
       size="icon-sm"
       className="size-6"
       aria-label={activeProjectId ? "New chat in project" : "New chat"}
       onClick={() => onNewChat(activeProjectId)}
      >
       <Plus className="size-3.5" />
      </Button>
     </div>
     {visibleChats.length === 0 ? (
      <p className="px-2.5 py-3 text-xs text-muted-foreground/70">
       {activeProjectId ? "No chats in this project" : "No chats yet"}
      </p>
     ) : (
      visibleChats.map((chat) => (
       <div
        key={chat.id}
        draggable={!chat.incognito}
        onDragStart={() => { if (!chat.incognito) setDraggingId(chat.id); }}
        onDragEnd={() => setDraggingId(null)}
       >
        {renderChat(chat)}
       </div>
      ))
     )}
    </div>,
   )}
   <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) onCollapseNav?.(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
     <DialogHeader>
      <DialogTitle>New project</DialogTitle>
      <p className="text-sm text-muted-foreground">Will this project use a team of agents?</p>
     </DialogHeader>
     <div className="grid gap-4">
      <label className="grid gap-1.5 text-xs text-muted-foreground">
       Name
       <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Research, Website, …" />
      </label>
      <div className="grid gap-2">
       <p className="text-sm font-medium">Agent-oriented project</p>
       <p className="text-xs text-muted-foreground">Create a team of agents with their own roles that work together.</p>
       <div className="grid grid-cols-2 gap-2">
        {([["chat", "No"], ["agents", "Yes"]] as const).map(([value, label]) => <button key={value} type="button" className={cn("rounded-lg border px-3 py-2 text-left text-xs transition-colors", agentMode === value ? "border-foreground bg-muted" : "border-border hover:bg-muted/50")} aria-pressed={agentMode === value} onClick={() => setAgentMode(value)}><span className="block font-medium">{label}</span><span className="mt-0.5 block text-muted-foreground">{value === "agents" ? "Team of agents" : "Regular project chats"}</span></button>)}
       </div>
      </div>
      {agentMode === "agents" ? <div className="grid gap-2"><label className="grid gap-2 text-xs text-muted-foreground">Team preset <select aria-label="Team preset" value={teamPreset} onChange={(event) => {
        const value = event.target.value;
        if (value === "ai") { setPresetPurpose("ai"); setPresetOpen(true); return; }
        setTeamPreset(value);
        const saved = savedPresets.find(p => p.id === value);
        setTeamDraft(saved ? { name: saved.name, description: saved.description, agents: saved.agents.map(a => ({ ...a })) } : null);
       }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="none">Start with an empty team</option><option value="starter">Coordinator, Planner, Software Engineer, Tester</option>{savedPresets.filter(p => !p.builtIn).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{teamPreset === "draft" ? <option value="draft">Reviewed team: {teamDraft?.name || "Untitled"}</option> : null}<option value="ai">Make a preset with AI…</option></select></label><Button variant="outline" size="sm" onClick={() => { setPresetPurpose("select"); setPresetOpen(true); }}><Sparkles className="size-3.5"/>{teamDraft ? `Review ${teamDraft.agents.length} agents` : "Browse or create presets"}</Button></div> : null}
      <div className="grid gap-1.5">
       <p className="text-xs text-muted-foreground">Color</p>
       <div className="flex flex-wrap gap-1.5">
        {PROJECT_COLORS.map((value) => (
         <button
          key={value}
          type="button"
          className={cn("size-7 rounded-full border-2", color === value ? "border-foreground" : "border-transparent")}
          style={{ backgroundColor: value }}
          aria-label={`Color ${value}`}
          onClick={() => setColor(value)}
         />
        ))}
       </div>
      </div>
      <div className="grid gap-1.5">
       <p className="text-xs text-muted-foreground">Icon</p>
       <div className="flex flex-wrap gap-1.5">
        {PROJECT_ICONS.map((value) => (
         <button
          key={value}
          type="button"
          className={cn(
           "inline-flex size-8 items-center justify-center rounded-lg text-white",
           icon === value ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "opacity-80 hover:opacity-100",
          )}
          style={{ backgroundColor: color }}
          aria-label={value}
          onClick={() => setIcon(value)}
         >
          <ProjectIconGlyph icon={value} className="size-3.5" />
         </button>
        ))}
       </div>
      </div>
     </div>
     {createError ? <p role="alert" className="text-sm text-destructive">{createError}</p> : null}
     <DialogFooter>
      <Button type="button" variant="outline" onClick={() => { setCreateOpen(false); onCollapseNav?.(); }}>Cancel</Button>
      <Button type="button" disabled={creating} onClick={() => void create()}>{creating ? "Creating…" : "Create"}</Button>
     </DialogFooter>
    </DialogContent>
   </Dialog>
   <TeamPresetDialog open={presetOpen} onOpenChange={setPresetOpen} projectId={activeProjectId && projects.find(p => p.id === activeProjectId)?.mode === "agents" ? activeProjectId : undefined} startWithAI={presetPurpose === "ai"} initialDraft={presetPurpose === "select" ? teamDraft || undefined : undefined} onUse={presetPurpose === "library" ? undefined : draft => { setTeamDraft(draft); setTeamPreset("draft"); }} useLabel="Use in new project"/>
  </div>
 );
}
