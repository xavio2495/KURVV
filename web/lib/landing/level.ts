/**
 * THE LEVEL — a hand-composed platformer, six viewports wide.
 *
 * There is no ground line and no per-section band. The world is a set of floating
 * masses placed at whatever height reads best, the way a real platformer screen is
 * built: clusters at several depths, gaps of open sky between them, and props
 * stacked on everything. Materials INTERLEAVE across the page rather than switching
 * at a seam — a stone slab sits inside the green stretch and a mossy one inside the
 * grey, so there is nowhere you can point at and say the theme changed there.
 *
 * Coordinates are resolution-independent:
 *   x  in viewport WIDTHS, 0 at the left of panel 0, 6 at the right of panel 5
 *   y  in viewport HEIGHTS, 0 at the top of the frame, 1 at the bottom
 *   s  drawn width as a fraction of one viewport width
 *
 * `z` is the depth band, and it sets both parallax and how far the piece is pushed
 * back into the haze:
 *   0  far    — silhouettes behind everything, slow
 *   1  mid    — the world you read as "the level"
 *   2  near   — foreground, faster than the level, deliberately overlapping
 */

/** Platform sprites. Every `TileStyle` sheet stores them at 176x80. */
export const PLAT_W = 176;
export const PLAT_H = 80;

const TS = (n: number) => `/flappy/tiles/TileStyle${n}.png`;

export type PlatKey =
  | "olive" | "tan" | "forest" | "teal" | "stone" | "slate"
  | "darkolive" | "darkteal" | "mauve" | "plum" | "lime" | "ash" | "grey" | "clay";

/** Sheet and source origin for each platform, measured off the sheets. */
export const PLATS: Record<PlatKey, { src: string; sx: number; sy: number }> = {
  olive: { src: TS(1), sx: 16, sy: 16 },
  tan: { src: TS(1), sx: 208, sy: 16 },
  forest: { src: TS(2), sx: 16, sy: 16 },
  teal: { src: TS(2), sx: 208, sy: 16 },
  stone: { src: TS(2), sx: 16, sy: 112 },
  slate: { src: TS(2), sx: 208, sy: 112 },
  darkolive: { src: TS(3), sx: 16, sy: 16 },
  darkteal: { src: TS(3), sx: 208, sy: 16 },
  mauve: { src: TS(3), sx: 16, sy: 112 },
  plum: { src: TS(3), sx: 208, sy: 112 },
  lime: { src: TS(4), sx: 16, sy: 16 },
  ash: { src: TS(4), sx: 208, sy: 16 },
  grey: { src: TS(5), sx: 16, sy: 16 },
  clay: { src: TS(5), sx: 208, sy: 16 },
};

/** Props, as source rects on `world/objects/staticObjects_.png`. */
export type PropKey =
  | "tree" | "bush" | "lamp" | "lamp2" | "pole" | "crate" | "barrel" | "sign"
  | "rock" | "fence" | "plank" | "post" | "vent" | "cart" | "box" | "bolt";

export const PROPS: Record<PropKey, [number, number, number, number]> = {
  tree: [160, 16, 73, 96],
  bush: [56, 14, 32, 50],
  lamp: [1, 17, 14, 47],
  lamp2: [97, 17, 14, 47],
  pole: [247, 16, 9, 96],
  crate: [16, 65, 33, 31],
  barrel: [64, 70, 38, 74],
  sign: [229, 114, 38, 30],
  rock: [33, 97, 20, 15],
  fence: [160, 87, 64, 9],
  plank: [144, 129, 80, 10],
  post: [129, 54, 14, 55],
  vent: [192, 37, 16, 27],
  cart: [5, 99, 26, 45],
  box: [32, 116, 16, 28],
  bolt: [145, 65, 14, 15],
};

export interface Plat {
  x: number;
  y: number;
  s: number;
  k: PlatKey;
  z: 0 | 1 | 2;
  /** Mirror horizontally, so a sprite used twice does not read as a repeat. */
  f?: boolean;
}

export interface Prop {
  x: number;
  y: number;
  /** Drawn height as a fraction of viewport height. */
  h: number;
  k: PropKey;
  z: 0 | 1 | 2;
  f?: boolean;
}

/** A string of coins hanging in a catenary between two points. */
export interface Arc {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
  /** Sag, in viewport heights. */
  sag: number;
}

/**
 * The composition.
 *
 * Read it as a side-on drawing: panel 0 is nearly empty because the page opens on
 * flat black, panels 1-4 are the level proper, and panel 5 climbs into a single
 * mountain that the device stands on.
 */
export const PLATFORMS: Plat[] = [
  // ── 0 · night — a few far silhouettes only; the page opens on black ──
  { x: 0.32, y: 0.86, s: 0.3, k: "darkteal", z: 0 },
  { x: 0.72, y: 0.94, s: 0.36, k: "darkolive", z: 0, f: true },
  { x: 0.1, y: 0.97, s: 0.28, k: "plum", z: 1 },

  // ── 0→1 · night bleeding into industry ──
  { x: 0.94, y: 0.78, s: 0.26, k: "slate", z: 0 },
  { x: 1.16, y: 0.92, s: 0.34, k: "slate", z: 1 },
  { x: 1.05, y: 0.55, s: 0.2, k: "plum", z: 1, f: true },
  { x: 1.42, y: 0.7, s: 0.3, k: "grey", z: 1 },
  { x: 1.3, y: 0.33, s: 0.22, k: "darkteal", z: 0 },
  { x: 1.66, y: 0.95, s: 0.4, k: "slate", z: 1, f: true },
  { x: 1.74, y: 0.46, s: 0.24, k: "grey", z: 1 },
  { x: 1.9, y: 0.24, s: 0.18, k: "mauve", z: 0 },
  { x: 1.52, y: 1.06, s: 0.3, k: "clay", z: 2 },

  // ── 1→2 · industry into winter; grey and stone overlap deliberately ──
  { x: 2.06, y: 0.84, s: 0.3, k: "grey", z: 1 },
  { x: 2.2, y: 0.52, s: 0.26, k: "ash", z: 1, f: true },
  { x: 2.44, y: 0.93, s: 0.36, k: "ash", z: 1 },
  { x: 2.3, y: 0.22, s: 0.2, k: "slate", z: 0 },
  { x: 2.66, y: 0.66, s: 0.28, k: "stone", z: 1 },
  { x: 2.86, y: 0.9, s: 0.32, k: "ash", z: 1, f: true },
  { x: 2.58, y: 1.08, s: 0.34, k: "grey", z: 2, f: true },
  { x: 2.94, y: 0.32, s: 0.22, k: "ash", z: 0 },

  // ── 2→3 · winter into summer ──
  { x: 3.12, y: 0.8, s: 0.3, k: "olive", z: 1 },
  { x: 3.02, y: 0.5, s: 0.22, k: "ash", z: 1, f: true },
  { x: 3.36, y: 0.95, s: 0.38, k: "lime", z: 1 },
  { x: 3.28, y: 0.28, s: 0.24, k: "forest", z: 0 },
  { x: 3.6, y: 0.62, s: 0.28, k: "olive", z: 1, f: true },
  { x: 3.82, y: 0.88, s: 0.34, k: "lime", z: 1 },
  { x: 3.7, y: 1.1, s: 0.32, k: "forest", z: 2 },
  { x: 3.94, y: 0.4, s: 0.2, k: "olive", z: 0, f: true },

  // ── 3→4 · summer into neon ──
  { x: 4.1, y: 0.74, s: 0.3, k: "teal", z: 1 },
  { x: 4.04, y: 0.44, s: 0.22, k: "lime", z: 1 },
  { x: 4.34, y: 0.92, s: 0.36, k: "plum", z: 1, f: true },
  { x: 4.26, y: 0.24, s: 0.2, k: "mauve", z: 0 },
  { x: 4.58, y: 0.6, s: 0.28, k: "mauve", z: 1 },
  { x: 4.8, y: 0.86, s: 0.34, k: "plum", z: 1 },
  { x: 4.66, y: 1.08, s: 0.3, k: "teal", z: 2, f: true },
  { x: 4.92, y: 0.38, s: 0.22, k: "darkteal", z: 0, f: true },

  // ── 5 · the mountain. ONE mass climbing to the right, and it has to read as a
  // slope: slabs this size overlap into a solid field of texture if they are not
  // kept small enough to leave sky between the treads.
  { x: 5.02, y: 1.0, s: 0.26, k: "clay", z: 1 },
  { x: 5.2, y: 0.92, s: 0.26, k: "grey", z: 1, f: true },
  { x: 5.36, y: 0.83, s: 0.26, k: "clay", z: 1 },
  { x: 5.52, y: 0.74, s: 0.26, k: "ash", z: 1, f: true },
  { x: 5.68, y: 0.66, s: 0.28, k: "olive", z: 1 },
  { x: 5.86, y: 0.58, s: 0.3, k: "lime", z: 1, f: true },
  { x: 6.06, y: 0.53, s: 0.32, k: "olive", z: 1 },
  // Two buttresses only, well below the treads, so the slope has a base without
  // the base becoming the picture.
  { x: 5.3, y: 1.16, s: 0.34, k: "grey", z: 1 },
  { x: 5.72, y: 1.08, s: 0.34, k: "ash", z: 1, f: true },
  // Far ridge behind it.
  { x: 5.2, y: 0.62, s: 0.28, k: "mauve", z: 0 },
  { x: 5.54, y: 0.44, s: 0.3, k: "plum", z: 0, f: true },
  { x: 5.9, y: 0.32, s: 0.28, k: "darkteal", z: 0 },
  // Floating islands over the summit.
  { x: 5.38, y: 0.28, s: 0.15, k: "lime", z: 1 },
  { x: 5.66, y: 0.17, s: 0.13, k: "olive", z: 1, f: true },
];

/** Hand-placed hero props. Everything else is scattered from the platform table. */
export const HERO_PROPS: Prop[] = [
  { x: 1.2, y: 0.92, h: 0.13, k: "cart", z: 1 },
  { x: 1.48, y: 0.7, h: 0.16, k: "pole", z: 1 },
  { x: 1.78, y: 0.46, h: 0.1, k: "vent", z: 1 },
  { x: 2.5, y: 0.93, h: 0.11, k: "sign", z: 1 },
  { x: 3.4, y: 0.95, h: 0.2, k: "tree", z: 1 },
  { x: 3.66, y: 0.62, h: 0.14, k: "bush", z: 1 },
  { x: 3.88, y: 0.88, h: 0.2, k: "tree", z: 1, f: true },
  { x: 4.4, y: 0.92, h: 0.15, k: "lamp2", z: 1 },
  { x: 4.86, y: 0.86, h: 0.13, k: "barrel", z: 1 },
  { x: 5.6, y: 0.7, h: 0.18, k: "tree", z: 1 },
  { x: 5.8, y: 0.57, h: 0.15, k: "bush", z: 1, f: true },
  { x: 5.4, y: 1.14, h: 0.12, k: "cart", z: 2 },
];

/** Coins strung between platforms, the way reference art does it. */
export const ARCS: Arc[] = [
  { x0: 1.2, y0: 0.86, x1: 1.44, y1: 0.66, n: 6, sag: 0.05 },
  { x0: 1.78, y0: 0.42, x1: 2.1, y1: 0.8, n: 7, sag: 0.06 },
  { x0: 2.24, y0: 0.48, x1: 2.5, y1: 0.88, n: 6, sag: 0.05 },
  { x0: 2.7, y0: 0.62, x1: 2.94, y1: 0.86, n: 5, sag: 0.04 },
  { x0: 3.06, y0: 0.46, x1: 3.36, y1: 0.9, n: 7, sag: 0.06 },
  { x0: 3.64, y0: 0.58, x1: 3.88, y1: 0.84, n: 5, sag: 0.04 },
  { x0: 4.08, y0: 0.4, x1: 4.36, y1: 0.88, n: 7, sag: 0.06 },
  { x0: 4.62, y0: 0.56, x1: 4.84, y1: 0.82, n: 5, sag: 0.04 },
  { x0: 5.36, y0: 0.32, x1: 5.62, y1: 0.2, n: 5, sag: 0.05 },
];

/** Which props suit which stretch of the world. Index by `Math.floor(x)`. */
export const SCATTER: PropKey[][] = [
  ["rock", "post"],
  ["crate", "barrel", "vent", "box", "lamp"],
  ["crate", "rock", "fence", "box", "lamp2"],
  ["bush", "tree", "fence", "rock", "plank"],
  ["lamp", "post", "bolt", "crate", "plank"],
  ["bush", "rock", "crate", "tree", "fence"],
];

/** Deterministic hash: the same world every load, and in every screenshot. */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
