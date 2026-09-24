"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type CliVersion = {
  id: string;
  name: string;
  version: string | null;
  source: string;
  note?: string;
  installable?: boolean;
  supportsVersion?: boolean;
};

export function CliVersionsPanel({ isHostAdmin }: { isHostAdmin: boolean }) {
  const [latestVersions, setLatestVersions] = useState<Record<string, string | null>>({});
  const [targetVersions, setTargetVersions] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [versions, setVersions] = useState<CliVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/providers/cli-versions", { cache: "no-store" });
      const body = await response.json() as { versions?: CliVersion[]; latestVersions?: Record<string, string | null>; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not read CLI versions.");
      setVersions(body.versions || []);
      setLatestVersions(body.latestVersions || {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read CLI versions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function installCli(item: CliVersion) {
    setInstalling(item.id);
    setError("");
    try {
      const version = item.supportsVersion ? targetVersions[item.id]?.trim() : undefined;
      const response = await fetch("/api/providers/cli-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: item.id, ...(version ? { version } : {}) }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `${item.name} installation failed.`);
      setTargetVersions((current) => ({ ...current, [item.id]: "" }));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${item.name} installation failed.`);
    } finally {
      setInstalling(null);
    }
  }

  return (
    <section aria-label="Installed CLI versions" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Agent runtimes installed on this server.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={loading || Boolean(installing)}>
          <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /> Refresh
        </Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {loading && versions.length === 0 ? <p className="text-sm text-muted-foreground">Checking CLI versions…</p> : null}
      {!loading && !error && versions.length === 0 ? <p className="text-sm text-muted-foreground">No agent runtimes found.</p> : null}
      {versions.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
          {versions.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-44 flex-1">
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.source}{item.note ? ` · ${item.note}` : ""}</p>
              </div>
              <span className="font-mono text-xs">{item.version || "Not installed"}</span>
              {isHostAdmin && item.installable ? (
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  {item.supportsVersion ? (
                    <input
                      aria-label={`${item.name} version`}
                      className="h-9 min-w-0 w-32 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                      value={targetVersions[item.id] || ""}
                      onChange={(event) => setTargetVersions((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder={latestVersions[item.id] || "Version"}
                      disabled={Boolean(installing)}
                    />
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void installCli(item)}
                    disabled={Boolean(installing) || loading || (item.supportsVersion && !targetVersions[item.id]?.trim() && !latestVersions[item.id])}
                  >
                    {installing === item.id ? "Installing…" : targetVersions[item.id]?.trim() ? "Install" : "Update"}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {isHostAdmin ? <p className="text-xs text-muted-foreground">Version fields accept a specific release. Cursor and Antigravity update to their latest releases. SDK versions update with Metis.</p> : null}
    </section>
  );
}
