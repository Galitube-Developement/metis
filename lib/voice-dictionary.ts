export const MAX_DICTIONARY_WORDS = 100;
export const MAX_DICTIONARY_WORD_LENGTH = 100;

export function normalizeVoiceDictionary(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const word = entry.trim().replace(/\s+/g, " ").slice(0, MAX_DICTIONARY_WORD_LENGTH);
    const key = word.toLocaleLowerCase();
    if (!word || seen.has(key)) return [];
    seen.add(key);
    return [word];
  }).slice(0, MAX_DICTIONARY_WORDS);
}

export function voiceDictionaryPrompt(value: unknown): string | undefined {
  const words = normalizeVoiceDictionary(value);
  return words.length ? words.join(", ") : undefined;
}
