"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Search, PlugZap, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Field = { id: string; name: string; description: string; required: boolean; secret: boolean; default: string; choices: string[] };
type ConnectionOption = { id: string; label: string; kind: string; fields: Field[] };
type Candidate = {
  name: string; title?: string; description?: string; status?: string;
  connectionOptions: ConnectionOption[]; websiteUrl?: string; repository?: { url?: string };
};
function documentationUrl(item: Candidate) {
  const url = item.websiteUrl || item.repository?.url;
  try { return url && new URL(url).protocol === "https:" ? url : undefined; } catch { return undefined; }
}
export function ConnectionCatalog({ isHostAdmin, onInstalled, onCustomize }: { isHostAdmin: boolean; onInstalled: () => void; onCustomize: (gatewayId: string) => void }) {
  const formId = useId();
  const setupForm = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [optionId, setOptionId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [setupError, setSetupError] = useState("");
  const [gatewayId, setGatewayId] = useState("");
  const [source, setSource] = useState("");
  const option = selected?.connectionOptions.find(item => item.id === optionId);
  useEffect(() => {
    if (selected) {
      setupForm.current?.scrollIntoView({ block: "nearest" });
      setupForm.current?.querySelector<HTMLInputElement>("input, select")?.focus({ preventScroll: true });
    }
  }, [selected]);
  function selectOption(item: ConnectionOption) {
    setOptionId(item.id); setValues(Object.fromEntries(item.fields.map(field => [field.id, field.default || ""]))); setSetupError("");
  }
  function configure(item: Candidate) {
    setSelected(item); setSetupError(""); setGatewayId("");
    if (item.connectionOptions[0]) selectOption(item.connectionOptions[0]);
  }
  async function search() {
    setLoading(true); setError(""); setResults(null); setSelected(null); setValues({});
    try {
      const response = await fetch("/api/connections/catalog?q=" + encodeURIComponent(query), { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not search connections.");
      setResults(body.results || []);
      try { if (new URL(body.source).hostname === "registry.modelcontextprotocol.io") setSource(body.source); } catch { /* Keep the official Registry link when no source is supplied. */ }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not search connections.";
      setError(message); toast.error(message);
    } finally { setLoading(false); }
  }
  async function install() {
    if (!selected || !option || busy) return;
    setBusy(selected.name); setSetupError("");
    try {
      const response = await fetch("/api/connections/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selected.name, optionId, configuration: values }) });
      const body = await response.json();
      setGatewayId(body.gatewayId || "");
      if (!response.ok || !body.enabled) throw new Error(body.error || "Connection setup failed.");
      setSelected(null); setValues({}); onInstalled();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not connect.";
      setSetupError(message); toast.error("Connection could not be enabled", { description: message });
    } finally { setBusy(""); }
  }
  return <section aria-label="Discover connections/MCPs" className="space-y-4">
    <div>
      <h3 className="text-lg font-semibold">Discover connections/MCPs</h3>
      <p className="mt-1 text-sm text-muted-foreground">Services and tools fetched from the <a href="https://registry.modelcontextprotocol.io" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">official MCP Registry</a>.</p>
      <p className="mt-1 text-xs text-muted-foreground">Configuration comes from each publisher’s registry entry. Package connections require Docker on the Metis server.{source ? <> <a href={source} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">Catalog API</a></> : null}</p>
    </div>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (query.trim()) void search(); }}>
      <Input className="min-w-0" value={query} disabled={Boolean(busy)} onChange={event => setQuery(event.target.value)} placeholder="Search services, tools or capabilities…" aria-label="Search connections" />
      <Button type="submit" disabled={loading || Boolean(busy) || !query.trim()}><Search className="size-4" /><span className="hidden sm:inline">Search</span></Button>
    </form>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Searching connection catalog…</p> : null}
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    {results?.length === 0 ? <p className="text-sm text-muted-foreground">No supported connections found. Try a capability name or add a custom connection below.</p> : null}
    {selected && option ? <form ref={setupForm} aria-label={"Configure " + (selected.title || selected.name)} className="space-y-4 border-y border-border py-5" onSubmit={event => { event.preventDefault(); void install(); }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h4 className="break-words font-medium">Configure {selected.title || selected.name}</h4><p className="mt-1 break-all text-xs text-muted-foreground">{selected.name}</p></div>
        <Button type="button" variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => { setSelected(null); setValues({}); }}>Cancel</Button>
      </div>
      <fieldset disabled={Boolean(busy) || !isHostAdmin} className="min-w-0 space-y-4">
        {selected.connectionOptions.length > 1 ? <label className="block space-y-2 text-sm">Connection method<select className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3" value={optionId} onChange={event => { const next = selected.connectionOptions.find(item => item.id === event.target.value); if (next) selectOption(next); }}>{selected.connectionOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : <p className="break-words text-sm text-muted-foreground">{option.label}</p>}
        {option.fields.length ? <div className="grid gap-4 sm:grid-cols-2">{option.fields.map((field, index) => {
          const id = formId + "-" + index;
          return <div key={field.id} className="min-w-0 space-y-2">
            <label htmlFor={id} className="block break-words text-sm font-medium">{field.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{field.required ? "Required" : "Optional"}</span></label>
            {field.choices.length ? <select id={id} required={field.required} className="h-10 w-full rounded-md border border-input bg-background px-3" value={values[field.id] || ""} aria-describedby={field.description ? id + "-hint" : undefined} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))}><option value="">Choose a value</option>{field.choices.map(value => <option key={value} value={value}>{value}</option>)}</select> : <Input id={id} type={field.secret ? "password" : "text"} autoComplete="off" required={field.required} value={values[field.id] || ""} aria-describedby={field.description ? id + "-hint" : undefined} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} />}
            {field.description ? <p id={id + "-hint"} className="break-words text-xs leading-5 text-muted-foreground">{field.description}</p> : null}
          </div>;
        })}</div> : <p className="text-sm text-muted-foreground">No additional configuration is listed. Test the connection to enable it.</p>}
        <p className="text-xs leading-5 text-muted-foreground">Credentials are saved on your Metis server and are never returned to this form. The connection is enabled only after its MCP test succeeds.</p>
        {documentationUrl(selected) ? <a href={documentationUrl(selected)} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 text-sm underline underline-offset-4">Publisher documentation<ExternalLink className="size-3.5" /></a> : null}
        {setupError ? <p role="alert" className="break-words text-sm text-destructive">{setupError}</p> : null}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={Boolean(busy)}>{busy ? "Testing connection…" : "Save & test connection"}</Button>{setupError && gatewayId ? <Button type="button" variant="outline" onClick={() => onCustomize(gatewayId)}>Edit advanced configuration</Button> : null}</div>
      </fieldset>
    </form> : null}
    <div className="grid gap-3 sm:grid-cols-2">{results?.map(item => <article key={item.name} className="min-w-0 rounded-xl border border-border p-4">
      <PlugZap className="mb-3 size-5 text-muted-foreground" /><h4 className="break-words text-sm font-medium">{item.title || item.name}</h4>
      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.description}</p>
      <Button className="mt-3" size="sm" variant="outline" disabled={!isHostAdmin || Boolean(busy) || !item.connectionOptions?.length} onClick={() => configure(item)}>Set up connection</Button>
    </article>)}</div>
    {!isHostAdmin ? <p className="text-xs text-muted-foreground">A host administrator can set up new server connections.</p> : null}
  </section>;
}
