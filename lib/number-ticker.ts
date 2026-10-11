export type TickerCharacter = { key: string; character: string; active: boolean };

/** Key digits by place value so punctuation and currency never shift their identity. */
export function tickerCharacters(parts: Intl.NumberFormatPart[]): TickerCharacter[] {
  let integerPlace = parts.filter(part => part.type === "integer").reduce((count, part) => count + part.value.length, 0);
  let fractionPlace = 0;
  return parts.flatMap((part, partIndex) => Array.from(part.value, (character, index) => ({
    key: part.type === "integer" ? "integer-" + --integerPlace
      : part.type === "fraction" ? "fraction-" + fractionPlace++
      : part.type === "group" ? "group-" + integerPlace
      : part.type + "-" + partIndex + "-" + index,
    character,
    active: true,
  })));
}

/** Keep departing columns until their width reaches zero; a reversal reuses them. */
export function reconcileTicker(previous: TickerCharacter[], next: TickerCharacter[], reduced = false): TickerCharacter[] {
  if (reduced) return next;
  const result = [...next];
  const live = new Set(next.map(item => item.key));
  previous.forEach((item, index) => {
    if (live.has(item.key)) return;
    const following = previous.slice(index + 1).find(candidate => result.some(entry => entry.key === candidate.key));
    const position = following ? result.findIndex(entry => entry.key === following.key) : result.length;
    result.splice(position, 0, { ...item, active: false });
  });
  return result;
}
