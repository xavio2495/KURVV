/**
 * Sprite loading for the 2D screens.
 *
 * Every screen draws whatever has arrived and nothing else — a sheet that is slow,
 * missing or blocked costs its own layer and never the frame. There is no await and
 * no ready gate, because the screen redraws continuously anyway: the next frame
 * picks up whatever landed.
 */

/**
 * WHERE THE ART LIVES — one switch, set once.
 *
 * Empty means `public/`, which is what a checkout with no configuration gets and
 * what the tests and the local dev loop use. Point it at a CDN origin and every
 * sheet moves with it, because nothing else in the codebase writes an asset path.
 *
 * `crossOrigin` is set unconditionally rather than only for remote sources: a canvas
 * that has drawn even one image without CORS is TAINTED, and a tainted canvas throws
 * on `toDataURL`. `/play`'s share button reads the device canvas, so the day the base
 * became a CDN the share button would break — and it would break at the one moment
 * it matters, on someone else's machine, with a security error nobody would connect
 * back to an asset move.
 */
export const ASSET_BASE = (process.env.NEXT_PUBLIC_ASSET_BASE ?? "").replace(/\/$/, "");

/** Resolve an app-relative asset path against the configured base. */
export const asset = (path: string): string =>
  `${ASSET_BASE}${path.startsWith("/") ? path : `/${path}`}`;

/** Returns null during SSR, where there is no `Image` to construct. */
export function loadSprite(src: string): HTMLImageElement | null {
  if (typeof document === "undefined") return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = asset(src);
  return img;
}

/** Safe to draw: decoded, non-zero, and not a failed request. */
export function ready(img: HTMLImageElement | null): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}
