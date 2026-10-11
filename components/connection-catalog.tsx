"use client";
import { useState } from "react";
import { Search, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Candidate = { name: string; title?: string; description?: string; status?: string };
export function ConnectionCatalog({ isHostAdmin, onInstalled }: { isHostAdmin: boolean; onInstalled: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function search() {
    setLoading(true); setError(""); setResults(null);
    try {
      const response = await fetch("/api/connections/catalog?q=" + encodeURIComponent(query));
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not search connections.");
      setResults(body.results || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not search connections."); }
    finally { setLoading(false); }
  }
  async function install(name: string) {
    setBusy(name); setError("");
    try {
      const response = await fetch("/api/connections/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const body = await response.json();
      if (!response.ok || !body.enabled) throw new Error((body.error || "Connection setup failed.") + (body.missingRequiredSecrets?.length ? " Required: " + body.missingRequiredSecrets.join(", ") : ""));
      onInstalled();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect."); }
    finally { setBusy(""); }
  }
  return <section aria-label="Discover connections" className="space-y-4">
    <div><h3 className="text-lg font-semibold">Discover connections</h3><p className="mt-1 text-sm text-muted-foreground">Search the MCP Registry for services and tools.</p></div>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (query.trim()) void search(); }}><Input className="min-w-0" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search services, tools or capabilities…" aria-label="Search connections" /><Button type="submit" disabled={loading || !query.trim()}><Search className="size-4" /><span className="hidden sm:inline">Search</span></Button></form>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Searching connection catalog…</p> : null}
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    {results?.length === 0 ? <p className="text-sm text-muted-foreground">No supported connections found. Try a capability name or add a custom connection below.</p> : null}
    <div className="grid gap-3 sm:grid-cols-2">{results?.map(item => <article key={item.name} className="min-w-0 rounded-xl border border-border p-4"><PlugZap className="mb-3 size-5 text-muted-foreground" /><h4 className="break-words text-sm font-medium">{item.title || item.name}</h4><p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.description}</p><Button className="mt-3" size="sm" variant="outline" disabled={!isHostAdmin || Boolean(busy)} onClick={() => void install(item.name)}>{busy === item.name ? "Connecting…" : "Set up connection"}</Button></article>)}</div>
    {!isHostAdmin ? <p className="text-xs text-muted-foreground">A host administrator can set up new server connections.</p> : null}
  </section>;
}
