"use client";
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConnectionCatalog } from "@/components/connection-catalog";
import type { AgentMode, ToolPermissionCategory } from "@/lib/store";
import { TOOL_PERMISSION_CATEGORIES } from "@/lib/modes";
type McpServer = {
  id: string;
  name: string;
  kind: "remote" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  configured_env_keys?: string[];
  configured_header_keys?: string[];
};

type McpDraft = {
  id: string;
  name: string;
  kind: "remote" | "stdio";
  url: string;
  command: string;
  args: string;
  env: string;
  headers: string;
};

const emptyMcpDraft: McpDraft = {
  id: "",
  name: "",
  kind: "remote",
  url: "",
  command: "",
  args: "",
  env: "",
  headers: "",
};

export function HubConnections({isHostAdmin}: {isHostAdmin: boolean}) {
 const [mcpServers,setMcpServers]=useState<McpServer[]>([]);
 const [mcpLoaded,setMcpLoaded]=useState(false);
 const [mcpError,setMcpError]=useState("");
 const [mcpDraft,setMcpDraft]=useState<McpDraft>(emptyMcpDraft);
 const [mcpBusy,setMcpBusy]=useState(false);
 const [formOpen,setFormOpen]=useState(false);
 const [deleteTarget,setDeleteTarget]=useState<McpServer|null>(null);
  const loadMcpServers = useCallback(async () => {
    setMcpError("");
    try {
      const res = await fetch("/api/mcp-servers", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load MCP servers");
      const data = (await res.json()) as { servers?: McpServer[] };
      setMcpServers(data.servers || []);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : "Failed to load connections");
    } finally {
      setMcpLoaded(true);
    }
  }, []);

useEffect(() => { void loadMcpServers(); }, [loadMcpServers]);
  function parseLines(value: string) {
    const entries: Record<string, string> = {};
    for (const line of value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const separator = line.indexOf("=");
      if (separator <= 0) throw new Error("Environment and header lines must use NAME=value");
      const key = line.slice(0, separator).trim();
      const item = line.slice(separator + 1);
      if (!/^[A-Za-z_][A-Za-z0-9-]*$/.test(key)) throw new Error(`Invalid key: ${key}`);
      entries[key] = item;
    }
    return entries;
  }

  async function saveMcpServer() {
    if (mcpBusy) return;
    setMcpBusy(true);
    try {
      if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(mcpDraft.id)) {
        throw new Error("ID must use 2-64 lowercase characters, numbers, dots, underscores, or hyphens");
      }
      if (!mcpDraft.name.trim()) throw new Error("Name is required");
      if (mcpDraft.kind === "remote" && !mcpDraft.url.trim()) throw new Error("URL is required");
      if (mcpDraft.kind === "stdio" && !mcpDraft.command.trim()) throw new Error("Command is required");
      const env = parseLines(mcpDraft.env);
      const headers = parseLines(mcpDraft.headers);
      const body = {
        id: mcpDraft.id.trim(),
        name: mcpDraft.name.trim(),
        kind: mcpDraft.kind,
        ...(mcpDraft.url.trim() ? { url: mcpDraft.url.trim() } : {}),
        ...(mcpDraft.command.trim() ? { command: mcpDraft.command.trim() } : {}),
        ...(mcpDraft.args.trim() ? { args: mcpDraft.args.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } : {}),
        ...(Object.keys(env).length ? { env } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      };
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to save MCP server");
      setMcpDraft(emptyMcpDraft);
      await loadMcpServers();
      toast.success("Connection saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save MCP server");
    } finally {
      setMcpBusy(false);
    }
  }

  function editMcpServer(server: McpServer) {
    setFormOpen(true);
    setMcpDraft({
      id: server.id,
      name: server.name,
      kind: server.kind,
      url: server.url || "",
      command: server.command || "",
      args: server.args?.join("\n") || "",
      env: "",
      headers: "",
    });
  }

  async function toggleMcpServer(server: McpServer) {
    const res = await fetch(`/api/mcp-servers/${encodeURIComponent(server.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !server.enabled }),
    });
    if (!res.ok) {
      toast.error("Failed to update MCP server");
      return;
    }
    await loadMcpServers();
  }

  async function deleteMcpServer(server: McpServer) {
    const res = await fetch(`/api/mcp-servers/${encodeURIComponent(server.id)}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete MCP server");
      return;
    }
    await loadMcpServers();
    if (mcpDraft.id === server.id) setMcpDraft(emptyMcpDraft);
    toast.success("Connection deleted");
  }

return <div className="space-y-8 p-5 sm:p-7"><ConnectionCatalog isHostAdmin={isHostAdmin} onInstalled={() => { void loadMcpServers(); toast.success("Connection ready"); }} /><section className="flex flex-col gap-4">
                <div>
                  <h3 className="text-lg font-semibold">Your connections</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Manage registered connections, including those configured by your agent. Credentials remain write-only.
                  </p>
                </div>
<details className="rounded-xl border border-border p-4" open={formOpen} onToggle={event => setFormOpen(event.currentTarget.open)}><summary className="min-h-10 cursor-pointer text-sm font-medium">Add or edit a custom connection</summary><fieldset disabled={!isHostAdmin || mcpBusy} className="space-y-4 pt-3">                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={mcpDraft.name}
                    onBlur={() => setMcpDraft(current => ({ ...current, id: current.id || current.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) }))}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, name: e.target.value }))}
                    placeholder="Display name"
                    aria-label="MCP server name"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={mcpDraft.kind === "remote" ? "default" : "outline"}
                    onClick={() => setMcpDraft((current) => ({ ...current, kind: "remote" }))}
                  >
                    Connect by URL
                  </Button>
                  <Button
                    type="button"
                    variant={mcpDraft.kind === "stdio" ? "default" : "outline"}
                    onClick={() => setMcpDraft((current) => ({ ...current, kind: "stdio" }))}
                  >
                    Run a local tool
                  </Button>
                </div>
                {mcpDraft.kind === "remote" ? (
                  <Input
                    value={mcpDraft.url}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, url: e.target.value }))}
                    placeholder="https://example.com/mcp"
                    aria-label="MCP server URL"
                  />
                ) : (
                  <>
                    <Input
                      value={mcpDraft.command}
                      onChange={(e) => setMcpDraft((current) => ({ ...current, command: e.target.value }))}
                      placeholder="npx"
                      aria-label="MCP command"
                    />
                    <Textarea
                      value={mcpDraft.args}
                      onChange={(e) => setMcpDraft((current) => ({ ...current, args: e.target.value }))}
                      placeholder={"One argument per line\n-y\n@modelcontextprotocol/server-filesystem\n/path/to/allowed-directory"}
                      aria-label="MCP arguments"
                      rows={4}
                    />
                  </>
                )}
                <details className="sm:col-span-2"><summary className="min-h-10 cursor-pointer text-sm">Credentials and advanced options</summary><div className="grid gap-3 pt-3 sm:grid-cols-2">                  <Input
                    value={mcpDraft.id}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, id: e.target.value }))}
                    placeholder="server-id"
                    aria-label="MCP server ID"
                  />

                  <Textarea
                    value={mcpDraft.env}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, env: e.target.value }))}
                    placeholder={"Environment (NAME=value)\nAPI_KEY=..."}
                    aria-label="MCP environment"
                    rows={4}
                  />
                  <Textarea
                    value={mcpDraft.headers}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, headers: e.target.value }))}
                    placeholder={"Headers (NAME=value)\nAuthorization=Bearer ..."}
                    aria-label="MCP headers"
                    rows={4}
                  />
                </div>
                </details>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => void saveMcpServer()} disabled={mcpBusy}>
                    {mcpBusy ? "Saving…" : "Save connection"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setMcpDraft(emptyMcpDraft)}>
                    Clear
                  </Button>
                </div>
</fieldset></details>
{mcpError ? <div role="alert" className="text-sm text-destructive">{mcpError}<Button variant="ghost" onClick={() => void loadMcpServers()}>Try again</Button></div> : null}
{mcpLoaded && !mcpError && !mcpServers.length ? <p className="text-sm text-muted-foreground">No connections configured. Search the catalog or add a custom connection.</p> : null}
<fieldset disabled={!isHostAdmin} className="min-w-0"><ul className="flex flex-col gap-2">
                  {!mcpLoaded ? (
                    [0, 1, 2].map((item) => (
                      <li key={item} className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3" aria-label="Loading MCP servers" role="status">
                        <Skeleton className="h-4 w-2/5" />
                        <Skeleton className="h-3 w-3/5" />
                      </li>
                    ))
                  ) : mcpServers.map((server) => (
                    <li key={server.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/40 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{server.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {server.id} · {server.kind} · {server.enabled ? "enabled" : "disabled"}
                        </p>
                        {(server.configured_env_keys?.length || server.configured_header_keys?.length) ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Secrets configured: {[...(server.configured_env_keys || []), ...(server.configured_header_keys || [])].join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => void toggleMcpServer(server)}>
                        {server.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => editMcpServer(server)}>
                        Edit
                      </Button>
                      <Button type="button" size="icon-sm" variant="ghost" onClick={() => setDeleteTarget(server)} aria-label={`Delete ${server.name}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul></fieldset>
              </section>

<ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)} title="Delete connection?" description={"Remove "+(deleteTarget?.name || "this connection")+" and its saved configuration?"} confirmLabel="Delete" onConfirm={() => deleteTarget ? deleteMcpServer(deleteTarget) : undefined} /></div>;
}
export function HubModes({onModesChanged}: {onModesChanged?: () => void}) {
const [modeError,setModeError]=useState("");
const [modesLoaded,setModesLoaded]=useState(false);
  const [customModes, setCustomModes] = useState<AgentMode[]>([]);
  const [modeDraft, setModeDraft] = useState<AgentMode>({
    id: "",
    name: "",
    description: "",
    icon: "sliders-horizontal",
    instructions: "",
    allowedCategories: ["read"],
  });
  const [modeOverridesDraft, setModeOverridesDraft] = useState("{}");
  const loadCustomModes = useCallback(async () => {
    setModeError("");
    try {
    const response = await fetch("/api/modes", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load modes");
    const data = (await response.json()) as { modes?: AgentMode[] };
    setCustomModes((data.modes || []).filter((mode) => !mode.builtIn));
    } catch (error) { setModeError(error instanceof Error ? error.message : "Could not load modes"); } finally { setModesLoaded(true); }
  }, []);

useEffect(() => { void loadCustomModes(); }, [loadCustomModes]);
  async function saveCustomMode() {
    try {
    const overrides = JSON.parse(modeOverridesDraft);
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || Object.values(overrides).some(value => typeof value !== "boolean")) throw new Error("Tool overrides must be a JSON object containing true or false values.");
    const payload = {
      ...modeDraft,
      id: modeDraft.id || undefined,
      allowedCategories: modeDraft.allowedCategories,
      toolOverrides: overrides,
    };
    const response = await fetch("/api/modes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      toast.error("Could not save mode");
      return;
    }
    setModeDraft({ id: "", name: "", description: "", icon: "sliders-horizontal", instructions: "", allowedCategories: ["read"] });
    setModeOverridesDraft("{}");
    await loadCustomModes();
    onModesChanged?.();
    toast.success("Mode saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save mode"); }
  }

  async function deleteCustomMode(mode: AgentMode) {
    try {
    const response = await fetch(`/api/modes?id=${encodeURIComponent(mode.id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Could not delete mode");
    await loadCustomModes();
    onModesChanged?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete mode"); }
  }

return <div className="p-5 sm:p-7"><section className="flex flex-col gap-4">
                <div>
                  <h3  className="text-sm font-medium">Agent modes</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Create reusable modes with custom instructions and server-enforced tool permissions.</p>
                </div>
                <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={modeDraft.name} onChange={(event) => setModeDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Mode name" aria-label="Mode name" />
                    <Input value={modeDraft.icon} onChange={(event) => setModeDraft((current) => ({ ...current, icon: event.target.value }))} placeholder="Icon name" aria-label="Mode icon" />
                  </div>
                  <Input value={modeDraft.description} onChange={(event) => setModeDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Short description" aria-label="Mode description" />
                  <Textarea value={modeDraft.instructions} onChange={(event) => setModeDraft((current) => ({ ...current, instructions: event.target.value }))} placeholder="Custom instructions for this mode" aria-label="Mode instructions" />
                  <div className="flex flex-wrap gap-1.5">
                    {TOOL_PERMISSION_CATEGORIES.map((category) => {
                      const active = modeDraft.allowedCategories.includes(category);
                      return <Button key={category} type="button" size="xs" variant={active ? "default" : "outline"} onClick={() => setModeDraft((current) => ({ ...current, allowedCategories: active ? current.allowedCategories.filter((item) => item !== category) : [...current.allowedCategories, category as ToolPermissionCategory] }))}>{category}</Button>;
                    })}
                  </div>
                  <Textarea value={modeOverridesDraft} onChange={(event) => setModeOverridesDraft(event.target.value)} placeholder='{"write_file": false}' aria-label="Individual tool overrides" className="min-h-16 font-mono text-xs" />
                  <p className="text-[11px] text-muted-foreground">Optional individual overrides as JSON, for example {"{"}"write_file": false{"}"}</p>
                  <div className="flex justify-end">
                    <Button type="button" onClick={() => void saveCustomMode()} disabled={!modeDraft.name.trim()}>Save mode</Button>
                  </div>
                </div>
                {customModes.length ? (
                  <div className="divide-y rounded-xl border">
                    {customModes.map((mode) => (
                      <div key={mode.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{mode.name}</p><p className="truncate text-xs text-muted-foreground">{mode.description || "Custom mode"}</p></div>
                        <Button type="button" size="xs" variant="ghost" onClick={() => { setModeDraft(mode); setModeOverridesDraft(JSON.stringify(mode.toolOverrides || {}, null, 2)); }}>Edit</Button>
                        <Button type="button" size="xs" variant="ghost" className="text-destructive" onClick={() => void deleteCustomMode(mode)}>Delete</Button>
                      </div>
                    ))}
                  </div>
                ) : null}
{modeError ? <p role="alert" className="text-sm text-destructive">{modeError}<Button variant="ghost" onClick={() => void loadCustomModes()}>Try again</Button></p> : null}{!modesLoaded ? <p role="status">Loading modes…</p> : !modeError && !customModes.length ? <p className="text-sm text-muted-foreground">No custom modes yet. Create one with the instructions and permissions above.</p> : null}
</section>

</div>;
}
