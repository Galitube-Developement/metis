export type BrowserViewportPhase = "empty" | "loading" | "live";

export function browserViewportPhase(input: {
  loading: boolean;
  hasFrame: boolean;
  url: string;
}): BrowserViewportPhase {
  if (input.loading) return "loading";
  if (input.hasFrame && input.url.trim()) return "live";
  return "empty";
}

export function browserFrameVisible(input: {
  loading: boolean;
  hasFrame: boolean;
  url: string;
}): boolean {
  return input.hasFrame && (input.loading || Boolean(input.url.trim()));
}
