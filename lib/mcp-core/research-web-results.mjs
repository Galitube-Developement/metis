/** Adapt the existing canonical web tools, including their configured fallback. */
function bodyOf(result) {
  if (result?.isError) throw new Error(result.content?.find(item => item.type === "text")?.text || "Web tool failed");
  if (result?.structuredContent) return result.structuredContent;
  if (!Array.isArray(result?.content)) return result;
  const text = result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
  try { return JSON.parse(text); } catch { return text; }
}
export function researchSearchResults(result) {
  const body = bodyOf(result);
  if (Array.isArray(body?.results)) return body;
  if (typeof body !== "string") throw new Error("Search returned no readable sources");
  const results = body.split(/(?=^Title:)/m).flatMap(block => {
    const match = block.match(/^Title:[ \t]*([^\n]*)\nURL:[ \t]*(https?:\/\/[^\s]+)[ \t]*\n?([\s\S]*)/);
    return match ? [{ title: match[1].trim(), url: match[2], content: match[3].trim() }] : [];
  });
  if (!results.length) throw new Error("Search fallback returned no structured source URLs");
  return { results };
}
export function researchFetchResults(result, url) {
  const body = bodyOf(result);
  if (Array.isArray(body?.results)) {
    const first = body.results[0];
    // Respect explicit browser routing; no fallback can turn a challenge into evidence.
    if (first?.ok || first?.requiresBrowser || !body.exa) return body;
    return researchFetchResults(body.exa, url);
  }
  if (typeof body === "string" && body.trim()) {
    const returnedUrl = body.match(/^URL:[ \t]*(https?:\/\/[^\s]+)/m)?.[1];
    if (!returnedUrl || new URL(returnedUrl).href !== new URL(url).href) throw new Error("Fetch fallback did not identify the requested source URL");
    return { results: [{ ok: true, url, title: body.match(/^#\s+(.+)$/m)?.[1] || url, content: body }] };
  }
  throw new Error("Fetch returned no readable source text");
}
