/**
 * Sprite loading for the 2D screens.
 *
 * Every screen draws whatever has arrived and nothing else — a sheet that is slow,
 * missing or blocked costs its own layer and never the frame. There is no await and
 * no ready gate, because the screen redraws continuously anyway: the next frame
 * picks up whatever landed.
 */

/** Returns null during SSR, where there is no `Image` to construct. */
export function loadSprite(src: string): HTMLImageElement | null {
  if (typeof document === "undefined") return null;
  const img = new Image();
  img.src = src;
  return img;
}

/** Safe to draw: decoded, non-zero, and not a failed request. */
export function ready(img: HTMLImageElement | null): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}
