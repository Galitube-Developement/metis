import { escape } from "minimatch";

export function fileNameSearchPattern(query: string): string {
  // Globs are explicit; plain names use a case-insensitive substring match.
  if (/[*?]/.test(query)) return query;
  const literal = query.split("/").map(segment => [...segment].map(char => {
    const lower = char.toLowerCase(), upper = char.toUpperCase();
    return lower !== upper && lower.length === 1 && upper.length === 1 ? `[${lower}${upper}]` : escape(char);
  }).join("")).join("/");
  return `**/*${literal}*`;
}
