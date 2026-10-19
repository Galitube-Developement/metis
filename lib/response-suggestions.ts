export type ResponseSuggestion = string | { label: string; prompt: string };

export const RESPONSE_SUGGESTIONS_PROMPT = [
  "Clickable reply suggestions: in a final interactive response, offer 1–3 concrete, context-specific replies when there is a useful next step, a natural follow-up question, or a choice the user may want to make. Prefer these clickable replies over a generic closing question such as 'Want me to continue?'. Write each inserted prompt from the user's perspective, in the user's language, so it makes sense as their next message.",
  "Use exactly one suggestions fenced block at the end, one reply per line. A line can be the full reply or a short label => full prompt. Example:\n```suggestions\nShow an example => Show me a concrete example of this approach.\nCompare the options => Compare these options and recommend one for my situation.\n```",
  "Clicking a suggestion only fills the composer; it does not send a message, execute an action, or grant approval. Use the required question/confirmation tool when a blocking answer or approval is needed; suggestions do not replace it. Continue already authorized work yourself instead of suggesting that the user request it again. If work remains blocked or incomplete, state the actual limitation and offer a concrete next step when useful; never imply completion.",
  "Omit suggestions for unattended automations, brief acknowledgements, or a fully resolved request with no useful follow-up. Respect an explicit request for no suggestions or an exact output format. Do not add generic filler, repeat the answer, invent unrelated tasks, or explain the fenced format outside its block.",
].join("\n");

const suggestionBlock = (value: string) => value.match(/```suggestions\s*\n([\s\S]*?)```/i);

export function extractSuggestions(value: string): { text: string; suggestions: ResponseSuggestion[] } {
  const match = suggestionBlock(value);
  if (!match) return { text: value, suggestions: [] };
  const suggestions = match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=>");
      if (separator <= 0) return line;
      const label = line.slice(0, separator).trim();
      const prompt = line.slice(separator + 2).trim();
      return label && prompt ? { label, prompt } : line;
    })
    .slice(0, 5);
  return {
    text: value.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim(),
    suggestions,
  };
}

/** Remove the UI-only block without moving commentary across tools/thoughts. */
export function stripSuggestionsFromParts<T extends { type: string; content?: string }>(parts: T[]): T[] {
  const match = suggestionBlock(parts.filter(part => part.type === "text").map(part => part.content || "").join(""));
  if (!match) return parts;
  const start = match.index!;
  const end = start + match[0].length;
  let offset = 0;
  return parts.flatMap(part => {
    if (part.type !== "text") return [part];
    const content = part.content || "";
    const partStart = offset;
    offset += content.length;
    if (offset <= start || partStart >= end) return [part];
    const next = content.slice(0, Math.max(0, start - partStart)) + content.slice(Math.max(0, end - partStart));
    return next ? [{ ...part, content: next }] : [];
  });
}
