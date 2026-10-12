export type ImageBounds = { left: number; top: number; width: number; height: number };
/** Bounds of the rendered pixels, excluding object-contain letterboxing. */
export function containedImageBounds(box: ImageBounds, naturalWidth: number, naturalHeight: number): ImageBounds | null {
  if (box.width <= 0 || box.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale, height = naturalHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}
export function magnifierZoom(current: number, delta: number) {
  return Math.max(1.25, Math.min(8, current * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002)));
}
export function magnifierGeometry(image: ImageBounds, surface: ImageBounds, x: number, y: number, zoom: number) {
  if (x < image.left || x > image.left + image.width || y < image.top || y > image.top + image.height) return null;
  const diameter = Math.min(240, surface.width, surface.height);
  const radius = diameter / 2;
  const left = Math.max(0, Math.min(surface.width - diameter, x - surface.left - radius));
  const top = Math.max(0, Math.min(surface.height - diameter, y - surface.top - radius));
  return { diameter, left, top, width: image.width * zoom, height: image.height * zoom,
    imageLeft: radius - (x - image.left) * zoom, imageTop: radius - (y - image.top) * zoom };
}
