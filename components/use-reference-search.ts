"use client";
import { useEffect, useMemo, useState } from "react";
import { createReferenceLookup, type ReferenceKind, type ReferenceSearchState } from "@/lib/reference-search";

export function useReferenceSearch<T>({ enabled, chatId, kind, query }: {
  enabled: boolean; chatId?: string | null; kind?: ReferenceKind | null; query: string;
}) {
  const lookup = useMemo(() => createReferenceLookup<T>(), []);
  const [state, setState] = useState<ReferenceSearchState<T> | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([chatId || "", kind || "", query, retry]);
  useEffect(() => {
    if (!enabled) { lookup.cancel(); setState(null); return; }
    const timer = window.setTimeout(() => { void lookup.load({ chatId, kind, query, key }, setState); }, 120);
    return () => { window.clearTimeout(timer); lookup.cancel(); };
  }, [enabled, chatId, kind, query, key, lookup]);
  const current = enabled && state?.key === key ? state : null;
  return {
    results: current?.results || [],
    loading: enabled && (!current || current.status === "loading" || Boolean(current.indexing && !current.results.length)),
    error: current?.status === "error" ? current.error : undefined,
    retry: () => setRetry(value => value + 1),
  };
}
