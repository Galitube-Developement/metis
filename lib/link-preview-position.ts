type Rect = Pick<DOMRect, "left" | "top" | "bottom" | "width" | "height">;

export function positionLinkPreview(anchor: Rect, preview: Rect, viewportWidth: number, viewportHeight: number) {
  const gap = 8;
  const left = Math.max(gap, Math.min(anchor.left, viewportWidth - preview.width - gap));
  const above = anchor.top - preview.height - gap;
  const below = anchor.bottom + gap;
  const top = above >= gap ? above : Math.min(below, viewportHeight - preview.height - gap);
  return { left, top: Math.max(gap, top) };
}
