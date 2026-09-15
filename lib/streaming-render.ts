export const STREAMING_RENDER_INTERVAL_MS = 64;

/** Immediate flush when content is replaced; throttle when it only appends. */
export function shouldFlushStreamingRender(shown: string, next: string): boolean {
  if (next === shown) return false;
  return !next.startsWith(shown);
}
