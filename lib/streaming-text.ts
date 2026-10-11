export const STREAM_FADE_MS = 480;
type Segment = { id: number; text: string; born: number };
export type StreamingTextState = { text: string; prefix: string; segments: Segment[]; nextId: number };
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export function initialStreamingText(text: string, now: number): StreamingTextState {
  return appendStreamingText({ text: "", prefix: "", segments: [], nextId: 0 }, text, now);
}

/** Bound the animated tail and retain stable keys for already visible text. */
export function appendStreamingText(previous: StreamingTextState, incoming: string, now: number): StreamingTextState {
  // An incomplete UTF-16 surrogate is not a complete token to display.
  const next = incoming.replace(/[\uD800-\uDBFF]$/, "");
  if (next === previous.text) return previous;
  if (!next.startsWith(previous.text)) return { text: next, prefix: next, segments: [], nextId: previous.nextId };
  let start = previous.text.length;
  if (start) {
    const last = graphemes.segment(previous.text).containing(previous.text.length - 1)!;
    const continued = graphemes.segment(next.slice(last.index))[Symbol.iterator]().next().value;
    if (continued && continued.segment.length > last.segment.length) start = last.index;
  }
  let prefix = previous.prefix.slice(0, start);
  let offset = previous.prefix.length;
  const segments: Segment[] = [];
  for (const segment of previous.segments) {
    const kept = { ...segment, text: segment.text.slice(0, Math.max(0, start - offset)) };
    offset += segment.text.length;
    if (!kept.text) continue;
    if (kept.born + STREAM_FADE_MS <= now && !segments.length) prefix += kept.text;
    else segments.push(kept);
  }
  segments.push({ id: previous.nextId, text: next.slice(start), born: now });
  return { text: next, prefix, segments, nextId: previous.nextId + 1 };
}
