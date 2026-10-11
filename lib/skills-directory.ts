export type DirectorySkill = { id: string; catalogId: string; title: string; description: string; source: string; category: string; installs?: number; url?: string };
type SearchResult = { skills: DirectorySkill[]; origin: "skills.sh" | "built-in"; notice?: string };
import { SKILL_CATALOG } from "@/lib/skill-catalog";
const cache = new Map<string, { expires: number; result: SearchResult }>();
const known = new Map<string, DirectorySkill>();
const pending = new Map<string, Promise<SearchResult>>();
function validatedSkill(item: unknown): DirectorySkill | null {
  if (!item || typeof item !== "object") return null;
  const s = item as Record<string, unknown>;
  const source = typeof s.source === "string" ? s.source : "";
  const id = typeof s.skillId === "string" ? s.skillId : typeof s.slug === "string" ? s.slug : typeof s.id === "string" ? s.id.split("/").pop()! : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(source) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) return null;
  const catalogId = source + "/" + id;
  return { id, catalogId, title: typeof s.name === "string" ? s.name.slice(0,160) : id, source, category: "Community", description: typeof s.description === "string" ? s.description.slice(0,600) : "", installs: typeof s.installs === "number" && Number.isFinite(s.installs) && s.installs >= 0 ? s.installs : undefined, url: "https://skills.sh/" + catalogId };
}
export function builtinSkills(): DirectorySkill[] {
  return SKILL_CATALOG.map(item => ({ ...item, catalogId: item.source + "/" + item.id, url: "https://skills.sh/" + item.source + "/" + item.id }));
}
export function knownDirectorySkill(catalogId: string) {
  return builtinSkills().find(item => item.catalogId === catalogId || item.id === catalogId) || known.get(catalogId);
}
export async function searchDirectory(query: string): Promise<SearchResult> {
  const q = query.trim().slice(0,120);
  if (q.length < 2) return { skills: builtinSkills(), origin: "built-in" };
  const key = q.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const running = pending.get(key); if (running) return running;
  const request = (async (): Promise<SearchResult> => {
    try {
      const token = process.env.VERCEL_OIDC_TOKEN?.trim();
      const endpoint = token ? "https://skills.sh/api/v1/skills/search" : "https://skills.sh/api/search";
      const url = new URL(endpoint); url.searchParams.set("q",q); url.searchParams.set("limit","24");
      const response = await fetch(url, { headers: token ? { Authorization: "Bearer " + token } : {}, signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) throw new Error("Directory unavailable");
      const text = await response.text(); if (text.length > 1_000_000) throw new Error("Directory response too large");
      const data = JSON.parse(text); const entries = token ? data.data : data.skills;
      if (!Array.isArray(entries)) throw new Error("Invalid directory response");
      const skills = entries.slice(0,24).map(validatedSkill).filter((s): s is DirectorySkill => Boolean(s));
      for (const skill of skills) known.set(skill.catalogId,skill);
      if (known.size > 3000) for (const id of [...known.keys()].slice(0,known.size-3000)) known.delete(id);
      const result: SearchResult = { skills, origin: "skills.sh" };
      cache.set(key,{ expires: Date.now()+300_000, result });
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      return result;
    } catch {
      const fallback = cached?.result.skills || builtinSkills().filter(item => (item.title+" "+item.description+" "+item.source).toLowerCase().includes(key));
      return { skills: fallback, origin: cached ? "skills.sh" : "built-in", notice: "Community search is temporarily unavailable. Showing saved results." };
    } finally { pending.delete(key); }
  })();
  pending.set(key,request); return request;
}
