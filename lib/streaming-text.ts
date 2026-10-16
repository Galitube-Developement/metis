export const STREAM_FADE_MS = 600;
export const STREAM_STAGGER_MS = 160;
type Segment = { id: number; text: string; born: number; delay?: number };
export type StreamingTextState = { text: string; prefix: string; segments: Segment[]; nextId: number };
function arrivingSegments(text: string, id: number, born: number, now: number): Segment[] {
  // A large checkpoint should reveal smoothly too, without a delay that grows with its length.
  const units = Array.from(graphemes.segment(text), item => item.segment);
  const size = Math.max(4, Math.ceil(units.length / 48));
  const count = Math.ceil(units.length / size);
  return Array.from({ length: count }, (_, index) => {
    const stagger = Math.min(STREAM_STAGGER_MS, index * 12);
    return { id: id + index, text: units.slice(index * size, (index + 1) * size).join(""), born: born + stagger, delay: now - born - stagger };
  });
}
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export function initialStreamingText(text: string, now: number, animateFrom = 0, born = now): StreamingTextState {
  const next = text.replace(/[\uD800-\uDBFF]$/, "");
  let from = Math.min(next.length, Math.max(0, animateFrom));
  if (from < next.length) from = graphemes.segment(next).containing(from)?.index ?? from;
  if (now - born >= STREAM_FADE_MS + STREAM_STAGGER_MS) from = next.length;
  const tail = next.slice(from);
  const segments = tail ? arrivingSegments(tail, 0, born, now) : [];
  return { text: next, prefix: next.slice(0, from), segments, nextId: segments.length };
}

export type StreamingArrival = { text: string; from: number; born: number };
export function initialStreamingArrival(text: string, now: number, initialBorn?: number): StreamingArrival {
  return { text, from: initialBorn !== undefined && now - initialBorn < STREAM_FADE_MS + STREAM_STAGGER_MS ? 0 : text.length, born: initialBorn ?? now };
}
export function appendStreamingArrival(previous: StreamingArrival, text: string, now: number): StreamingArrival {
  if (text === previous.text) return previous;
  return { text, from: text.startsWith(previous.text) ? previous.text.length : text.length, born: now };
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
  const added = arrivingSegments(next.slice(start), previous.nextId, now, now);
  segments.push(...added);
  return { text: next, prefix, segments, nextId: previous.nextId + added.length };
}
