import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { localWebSearch } from "./local-search.mjs";
import { localWebFetch } from "./local-scraper.mjs";

const integer = (value, fallback, max) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Expected an integer from 1 to ${max}`);
  return n;
};
const digest = value => createHash("sha256").update(value).digest("hex");
function publicUrl(value) {
  const url = new URL(String(value || ""));
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("A public HTTP(S) URL without credentials is required");
  url.hash = "";
  return url.href;
}
function linesOf(content) {
  // Keep line ranges useful even for pages extracted as a single huge paragraph.
  return String(content).replace(/\r\n?/g, "\n").split("\n").flatMap(line => line.match(/.{1,240}/gu) || [""]);
}
const summary = source => ({
  sourceId: source.sourceId, title: source.title, url: source.url,
  opened: Boolean(source.lines), discoveredAt: source.discoveredAt,
  ...(source.retrievedAt ? { retrievedAt: source.retrievedAt, totalLines: source.lines.length, truncated: source.truncated } : {}),
  ...(!source.lines ? { snippet: source.snippet } : {}),
});

/** Cache only: identity comes exclusively from the authenticated run, never tool arguments. */
export function createResearchTools({ stateDir, search = options => localWebSearch({ ...options, timeoutMs: 15_000 }), fetchPages = localWebFetch } = {}) {
  if (!stateDir) throw new Error("Research state directory is required");
  const ephemeral = new Map();
  function directory(context) {
    if (!context.userId || !context.chatId || !context.jobId) throw new Error("Research tools require an authenticated chat run");
    const key = digest(JSON.stringify([context.userId, context.chatId, context.jobId]));
    if (context.incognito) {
      for (const [id, state] of ephemeral) if (state.expires < Date.now()) ephemeral.delete(id);
      if (!ephemeral.has(key)) {
        if (ephemeral.size >= 128) ephemeral.delete(ephemeral.keys().next().value);
        ephemeral.set(key, { sources: new Map(), expires: Date.now() + 86_400_000 });
      }
      return "memory:" + key;
    }
    return path.join(stateDir, "research", key);
  }
  async function read(dir, id) {
    if (!/^src_[a-f0-9]{24}$/.test(String(id))) throw new Error("Invalid research source ID");
    if (dir.startsWith("memory:")) {
      const source = ephemeral.get(dir.slice(7))?.sources.get(id);
      if (!source) throw new Error("Source not found in this research run");
      return structuredClone(source);
    }
    try { return JSON.parse(await fs.readFile(path.join(dir, id + ".json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") throw new Error("Source not found in this research run"); throw error; }
  }
  async function save(dir, source, onlyMissing = false) {
    if (dir.startsWith("memory:")) {
      const sources = ephemeral.get(dir.slice(7)).sources;
      if (!onlyMissing || !sources.has(source.sourceId)) sources.set(source.sourceId, structuredClone(source));
      return;
    }
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const dest = path.join(dir, source.sourceId + ".json");
    const temp = dest + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temp, JSON.stringify(source), { mode: 0o600 });
      if (onlyMissing) {
        try { await fs.link(temp, dest); } catch (error) { if (error.code !== "EEXIST") throw error; }
      } else await fs.rename(temp, dest);
    }
    finally { await fs.rm(temp, { force: true }); }
  }
  async function candidate(dir, item) {
    const url = publicUrl(item.url);
    const sourceId = "src_" + digest(url).slice(0, 24);
    try { return await read(dir, sourceId); } catch (error) {
      if (error.message !== "Source not found in this research run") throw error;
    }
    const source = { sourceId, url, title: String(item.title || url).slice(0, 500),
      snippet: String(item.content || "").slice(0, 2000), discoveredAt: new Date().toISOString() };
    await save(dir, source, true);
    return read(dir, sourceId);
  }
  function excerpt(source, args) {
    const start = integer(args.start_line, 1, Math.max(1, source.lines.length));
    const count = integer(args.line_count, 60, 160);
    const selected = source.lines.slice(start - 1, start - 1 + count);
    return { ...summary(source), startLine: start, endLine: start + selected.length - 1,
      hasMore: start - 1 + selected.length < source.lines.length,
      content: selected.map((line, i) => `L${start + i}: ${line}`).join("\n"),
      citation: { title: source.title, url: source.url }, untrustedContent: true };
  }
  return async function research(name, args = {}, context = {}) {
    const dir = directory(context);
    if (name === "research_search") {
      if (!Array.isArray(args.queries) || args.queries.length < 1 || args.queries.length > 5
        || args.queries.some(q => typeof q !== "string" || !q.trim() || q.length > 1000)) throw new Error("Provide 1–5 nonempty search queries, at most 1000 characters each");
      const count = integer(args.num_results, 5, 10);
      const results = await Promise.all(args.queries.map(async query => {
        try {
          const found = await search({ query: query.trim(), numResults: count }, context);
          const sources = [];
          for (const item of (found.results || []).slice(0, count)) {
            try { sources.push(summary(await candidate(dir, item))); } catch (error) {
              if (!(error instanceof TypeError) && !error.message.startsWith("A public HTTP")) throw error;
            }
          }
          return { query, ok: sources.length > 0, sources, ...(sources.length ? {} : { error: "No search results" }) };
        } catch (error) { return { query, ok: false, sources: [], error: error.message }; }
      }));
      return { ok: results.some(result => result.ok), results, instruction: "Open sources before citing claims; snippets are unverified discovery leads." };
    }
    if (name === "research_open") {
      if (Boolean(args.source_id) === Boolean(args.url)) throw new Error("Provide exactly one of source_id or url");
      const source = args.source_id ? await read(dir, args.source_id) : await candidate(dir, { url: args.url });
      if (!source.lines) {
        const payload = await fetchPages({ urls: [source.url], maxChars: 100_000 }, context);
        const page = payload.results?.[0];
        if (!page?.ok || !String(page.content || "").trim()) return {
          ok: false, ...summary(source), requiresBrowser: Boolean(page?.requiresBrowser),
          error: page?.error || "Source could not be read",
          instruction: page?.requiresBrowser ? "Use the persistent Metis browser; do not bypass authentication or challenges." : "Try another source or report this access limitation.",
        };
        source.title = String(page.title || source.title).slice(0, 500);
        source.retrievedAt = new Date().toISOString();
        source.lines = linesOf(String(page.content).slice(0, 100_000));
        source.truncated = Boolean(page.truncated || String(page.content).length >= 100_000);
        await save(dir, source);
      }
      return { ok: true, ...excerpt(source, args) };
    }
    if (name === "research_find") {
      const source = await read(dir, args.source_id);
      if (!source.lines) throw new Error("Open this source before searching its text");
      const query = String(args.query || "").trim().toLowerCase();
      if (!query || query.length > 1000) throw new Error("A search phrase of 1–1000 characters is required");
      const all = source.lines.flatMap((line, index) => line.toLowerCase().includes(query) ? [index] : []);
      return { ...summary(source), matchCount: all.length, matches: all.slice(0, 30).map(index => ({
        line: index + 1, content: source.lines.slice(Math.max(0, index - 1), index + 2)
          .map((line, offset) => `L${Math.max(0, index - 1) + offset + 1}: ${line}`).join("\n"),
      })), untrustedContent: true };
    }
    if (name === "research_sources") {
      if (dir.startsWith("memory:")) {
        const sources = [...ephemeral.get(dir.slice(7)).sources.values()].map(summary);
        return { sources, openedCount: sources.filter(source => source.opened).length };
      }
      let names;
      try { names = await fs.readdir(dir); } catch (error) { if (error.code === "ENOENT") return { sources: [], openedCount: 0 }; throw error; }
      const sources = [];
      for (const name of names.filter(name => /^src_[a-f0-9]{24}\.json$/.test(name))) sources.push(summary(await read(dir, name.slice(0, -5))));
      sources.sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt) || a.sourceId.localeCompare(b.sourceId));
      return { sources, openedCount: sources.filter(source => source.opened).length };
    }
    throw new Error("Unknown research tool");
  };
}

const objectSchema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const sourceId = { type: "string", description: "Exact sourceId returned by research_search/open in this run." };
export const RESEARCH_TOOLS = [
  { name: "research_search", description: "Search 1–5 focused queries concurrently and register sources for Deep Research. Results are discovery leads; open a source to verify it. Sources are scoped to the authenticated account, chat and run.",
    inputSchema: objectSchema({ queries: { type: "array", items: { type: "string", minLength: 1, maxLength: 1000 }, minItems: 1, maxItems: 5 }, num_results: { type: "integer", minimum: 1, maximum: 10 } }, ["queries"]) },
  { name: "research_open", description: "Read a public research source by source_id or URL. Cache its text for this run and return numbered passages, title, citation URL and retrieval time. Use start_line/line_count to read more. For requiresBrowser use the persistent Metis browser.",
    inputSchema: objectSchema({ source_id: sourceId, url: { type: "string" }, start_line: { type: "integer", minimum: 1 }, line_count: { type: "integer", minimum: 1, maximum: 160 } }) },
  { name: "research_find", description: "Find a literal phrase in an opened source and return matching line numbers with surrounding text. No regex. Use research_open to read wider context.",
    inputSchema: objectSchema({ source_id: sourceId, query: { type: "string", minLength: 1, maxLength: 1000 } }, ["source_id", "query"]) },
  { name: "research_sources", description: "List this run's discovered and opened research sources, URLs and retrieval times. Audit which sources were actually read before citing evidence.",
    inputSchema: objectSchema({}) },
].map(tool => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false } }));
