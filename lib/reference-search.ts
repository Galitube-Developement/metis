export const REFERENCE_KINDS = ["file", "canvas", "plan", "note", "issue", "browser", "terminal", "memory", "chat"] as const;
export type ReferenceKind = typeof REFERENCE_KINDS[number];
export type ReferenceResult = {
  kind: ReferenceKind; id: string; label: string; detail?: string; chatId?: string;
  isCurrentChat?: boolean; path?: string; content?: string; sessionId?: string;
};

export const normalizeReferenceText = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/ß/g, "ss");
/** Search words independently; accents and German spelling should not hide a result. */
export function referenceMatches(query: string, ...values: Array<string | undefined>) {
  const terms = normalizeReferenceText(query).trim().split(/\s+/).filter(Boolean);
  const haystack = normalizeReferenceText(values.filter(Boolean).join(" "));
  return terms.every(term => haystack.includes(term));
}

export type ReferenceSearchState<T> = { key: string; status: "loading" | "ready" | "error"; results: T[]; error?: string; indexing?: boolean };

/** One active lookup; invalidation also protects against transports that ignore AbortSignal. */
export function createReferenceLookup<T>(fetcher: typeof fetch = fetch) {
  let revision = 0;
  let controller: AbortController | undefined;
  const cancel = () => { revision++; controller?.abort(); };
  return {
    cancel,
    async load(input: { chatId?: string | null; kind?: ReferenceKind | null; query: string; key: string },
      publish: (state: ReferenceSearchState<T>) => void) {
      cancel();
      const request = revision;
      controller = new AbortController();
      const current = controller;
      publish({ key: input.key, status: "loading", results: [] });
      try {
        const params = new URLSearchParams({ q: input.query, chatId: input.chatId || "" });
        if (input.kind) params.set("kind", input.kind);
        while(request === revision && !current.signal.aborted) {
        const response = await fetcher("/api/references?" + params, { cache: "no-store", signal: current.signal });
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to search your context." : "Could not load context. Try again.");
        const body = await response.json() as { results?: T[]; indexing?:boolean };
        if (!Array.isArray(body.results)) throw new Error("Could not load context. Try again.");
        if (request === revision && !current.signal.aborted) publish({ key: input.key, status: "ready", results: body.results, ...(body.indexing?{indexing:true}:{}) });
        if(!body.indexing)return;
        await new Promise<void>(resolve=>{
          const done=()=>{clearTimeout(timer);current.signal.removeEventListener("abort",done);resolve();};
          const timer=setTimeout(done,500);
          current.signal.addEventListener("abort",done,{once:true});
          if(current.signal.aborted)done();
        });
        }
      } catch (error) {
        if (request === revision && !current.signal.aborted) publish({
          key: input.key, status: "error", results: [],
          error: error instanceof Error ? error.message : "Could not load context. Try again.",
        });
      }
    },
  };
}
