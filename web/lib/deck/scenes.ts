/**
 * THE DECK'S SEVEN PLACES.
 *
 * Every slide of `/pitch` is a finished scene with its own art pack, its own ground
 * and its own weather. Nothing here fades up from black and nothing crossfades into
 * a neighbour — that is the landing page's trick, where the whole point is one
 * continuous world being built as you travel it. A deck is the opposite: each slide
 * arrives complete, holds, and is pushed off by the next one.
 *
 * Coordinates are fractions of the frame: `x` across, `y` down, `s` as a share of
 * frame width. Motion is a function of elapsed time only, so a slide looks the same
 * every time it is shown and identical in the demo video.
 */

import type { PlatKey, PropKey } from "../landing/level.ts";

/** A parallax band: one sheet, tiled sideways, drifting on its own. */
export interface Band {
  src: string;
  /** Drawn height and bottom edge, as fractions of frame height. */
  h: number;
  base: number;
  /** Drift in frame-widths per second. Negative moves left. */
  drift: number;
  alpha?: number;
  tileY?: boolean;
  /** Take one column `px` wide at index `col` and stretch it. For palette sheets. */
  strip?: { px: number; col: number };
}

export interface Slab { k: PlatKey; x: number; y: number; s: number; f?: boolean }
export interface Item { k: PropKey; x: number; y: number; h: number; f?: boolean }

/** A tiled ground band across the foot of the frame. */
export interface Ground {
  src: string;
  top: [number, number];
  fill: [number, number];
  /** Flat colour below the first courses — these sheets are far too busy to tile
   *  down a quarter of the frame without reading as noise. */
  deep: string;
  y: number;
}

export interface Arc { x0: number; y0: number; x1: number; y1: number; n: number; sag: number }
export interface Flier { src: string; x: number; y: number; s: number; rate: number; drift: number; bob: number }

export type Weather = "none" | "snow" | "ember" | "spark" | "leaf" | "rain";

export interface Scene {
  key: string;
  /** Flat wash under everything, so a slide is never a black hole while sheets load. */
  wash: string;
  bands: Band[];
  ground?: Ground;
  slabs: Slab[];
  items: Item[];
  arcs: Arc[];
  fliers: Flier[];
  weather: Weather;
  /** Particle count and tint. */
  wn: number;
  wtint: string;
}

const T = 16;
const SEASON = (name: string) => `/world/seasons/${name}_.png`;
const BG = (n: number) => `/flappy/background/Background${n}.png`;
const BIRD1 = (n: number) => `/flappy/player/StyleBird1/Bird1-${n}.png`;
const BIRD2 = (n: number) => `/flappy/player/StyleBird2/Bird2-${n}.png`;

/** Row 17 caps and row 19 fills on every season sheet — measured, not assumed. */
const season = (name: string, deep: string, y = 0.8): Ground => ({
  src: SEASON(name),
  top: [0, 17 * T],
  fill: [0, 19 * T],
  deep,
  y,
});

export const SCENES: Scene[] = [
  // ── 0 · HERO — the neon city at night, the whole pack at full strength ──
  {
    key: "neon-night",
    wash: "#120a26",
    bands: [
      { src: "/world/sky_.png", h: 1.05, base: 1, drift: 0, alpha: 0.9, strip: { px: 16, col: 2 } },
      { src: "/neon/Cloud2.png", h: 0.5, base: 0.6, drift: -0.006, alpha: 0.8 },
      { src: "/neon/city_02.png", h: 0.46, base: 0.86, drift: -0.012 },
      { src: "/neon/Cloud1.png", h: 0.42, base: 0.54, drift: -0.02, alpha: 0.85 },
      { src: "/neon/city_01.png", h: 0.5, base: 0.94, drift: -0.032 },
      { src: "/neon/BG_fog.png", h: 0.4, base: 1, drift: -0.05, alpha: 0.55 },
    ],
    ground: { src: "/neon/tiles_16x16.png", top: [0, 0], fill: [0, 2 * T], deep: "#1c1e3e", y: 0.84 },
    slabs: [
      { k: "plum", x: 0.12, y: 0.7, s: 0.26 },
      { k: "mauve", x: 0.86, y: 0.62, s: 0.24, f: true },
      { k: "darkteal", x: 0.5, y: 0.32, s: 0.18 },
    ],
    items: [
      { k: "lamp2", x: 0.14, y: 0.7, h: 0.11 },
      { k: "pole", x: 0.88, y: 0.62, h: 0.13, f: true },
    ],
    arcs: [{ x0: 0.2, y0: 0.62, x1: 0.44, y1: 0.44, n: 6, sag: 0.05 }],
    fliers: [
      { src: BIRD1(3), x: 0.28, y: 0.2, s: 0.06, rate: 10, drift: 0.02, bob: 0.02 },
      { src: BIRD2(5), x: 0.72, y: 0.14, s: 0.045, rate: 8, drift: -0.015, bob: 0.026 },
    ],
    weather: "spark",
    wn: 40,
    wtint: "#ff6bd6",
  },

  // ── 1 · THE PROBLEM — the machine, industrial through and through ──
  {
    key: "industry",
    wash: "#1b1b26",
    bands: [
      { src: "/industrial/paralax-background.png", h: 0.66, base: 1, drift: -0.004, tileY: true, alpha: 0.95 },
      { src: "/industrial/straight-pipe.png", h: 0.08, base: 0.34, drift: -0.014, alpha: 0.9 },
      { src: "/industrial/straight-pipe.png", h: 0.06, base: 0.2, drift: -0.024, alpha: 0.7 },
    ],
    ground: { src: "/industrial/industrial-tileset.png", top: [0, 0], fill: [0, 2 * T], deep: "#1c2130", y: 0.82 },
    slabs: [
      { k: "slate", x: 0.16, y: 0.66, s: 0.28 },
      { k: "grey", x: 0.82, y: 0.56, s: 0.26, f: true },
      { k: "slate", x: 0.56, y: 0.4, s: 0.2 },
    ],
    items: [
      { k: "cart", x: 0.18, y: 0.66, h: 0.12 },
      { k: "vent", x: 0.84, y: 0.56, h: 0.09, f: true },
      { k: "crate", x: 0.6, y: 0.4, h: 0.08 },
      { k: "barrel", x: 0.3, y: 0.82, h: 0.13 },
    ],
    arcs: [],
    fliers: [{ src: BIRD2(2), x: 0.66, y: 0.18, s: 0.045, rate: 12, drift: 0.018, bob: 0.018 }],
    weather: "ember",
    wn: 34,
    wtint: "#ffa640",
  },

  // ── 2 · THE INSIGHT — winter. Cold, clean, one clear line. ──
  {
    key: "winter",
    wash: "#7fb8c9",
    bands: [
      { src: BG(2), h: 1, base: 1, drift: -0.003 },
      { src: "/neon/city_02.png", h: 0.36, base: 0.84, drift: -0.01, alpha: 0.28 },
    ],
    ground: season("winter", "#3c4650", 0.82),
    slabs: [
      { k: "ash", x: 0.14, y: 0.62, s: 0.26 },
      { k: "stone", x: 0.84, y: 0.68, s: 0.26, f: true },
      { k: "ash", x: 0.52, y: 0.36, s: 0.18, f: true },
    ],
    items: [
      { k: "post", x: 0.16, y: 0.62, h: 0.12 },
      { k: "rock", x: 0.86, y: 0.68, h: 0.06, f: true },
      { k: "fence", x: 0.4, y: 0.82, h: 0.03 },
    ],
    arcs: [{ x0: 0.22, y0: 0.56, x1: 0.5, y1: 0.34, n: 7, sag: 0.05 }],
    fliers: [{ src: BIRD1(6), x: 0.34, y: 0.16, s: 0.055, rate: 9, drift: 0.02, bob: 0.024 }],
    weather: "snow",
    wn: 90,
    wtint: "#ffffff",
  },

  // ── 3 · HOW IT WORKS — spring, the season nothing else uses ──
  {
    key: "spring",
    wash: "#6fae7a",
    bands: [
      { src: BG(7), h: 1, base: 1, drift: -0.004 },
    ],
    ground: season("spring", "#1e3a24", 0.8),
    slabs: [
      { k: "lime", x: 0.15, y: 0.64, s: 0.28 },
      { k: "olive", x: 0.85, y: 0.58, s: 0.26, f: true },
      { k: "forest", x: 0.5, y: 0.34, s: 0.2 },
    ],
    items: [
      { k: "tree", x: 0.17, y: 0.64, h: 0.19 },
      { k: "bush", x: 0.87, y: 0.58, h: 0.1, f: true },
      { k: "tree", x: 0.54, y: 0.34, h: 0.15, f: true },
      { k: "plank", x: 0.36, y: 0.8, h: 0.03 },
    ],
    arcs: [
      { x0: 0.24, y0: 0.58, x1: 0.48, y1: 0.32, n: 7, sag: 0.05 },
      { x0: 0.58, y0: 0.34, x1: 0.82, y1: 0.55, n: 6, sag: 0.05 },
    ],
    fliers: [
      { src: BIRD1(1), x: 0.3, y: 0.18, s: 0.055, rate: 11, drift: 0.024, bob: 0.02 },
      { src: BIRD2(4), x: 0.7, y: 0.12, s: 0.04, rate: 9, drift: -0.016, bob: 0.026 },
    ],
    weather: "none",
    wn: 0,
    wtint: "#ffffff",
  },

  // ── 4 · THE CENTREPIECE — deep night. Nobody is awake and it runs anyway. ──
  {
    key: "deep-night",
    wash: "#0a1030",
    bands: [
      { src: BG(5), h: 1, base: 1, drift: -0.002 },
      { src: "/neon/city_01.png", h: 0.42, base: 0.9, drift: -0.01, alpha: 0.55 },
      { src: "/industrial/straight-pipe.png", h: 0.07, base: 0.28, drift: -0.02, alpha: 0.8 },
      { src: "/neon/BG_fog.png", h: 0.34, base: 1, drift: -0.03, alpha: 0.4 },
    ],
    ground: { src: "/neon/tiles_16x16.png", top: [0, 0], fill: [0, 2 * T], deep: "#141833", y: 0.84 },
    slabs: [
      { k: "darkteal", x: 0.13, y: 0.6, s: 0.26 },
      { k: "plum", x: 0.87, y: 0.66, s: 0.26, f: true },
      { k: "mauve", x: 0.5, y: 0.3, s: 0.2, f: true },
    ],
    items: [
      { k: "lamp", x: 0.15, y: 0.6, h: 0.11 },
      { k: "lamp2", x: 0.85, y: 0.66, h: 0.11, f: true },
      { k: "bolt", x: 0.52, y: 0.3, h: 0.05 },
    ],
    arcs: [{ x0: 0.2, y0: 0.54, x1: 0.8, y1: 0.6, n: 11, sag: 0.1 }],
    fliers: [{ src: BIRD2(7), x: 0.5, y: 0.14, s: 0.05, rate: 7, drift: 0.012, bob: 0.03 }],
    weather: "rain",
    wn: 70,
    wtint: "#8fd8ff",
  },

  // ── 5 · THE TRADE-OFF — autumn. The honest, late-in-the-year slide. ──
  {
    key: "autumn",
    wash: "#8a7a5c",
    bands: [
      { src: BG(8), h: 1, base: 1, drift: -0.003 },
      { src: "/neon/Cloud1.png", h: 0.34, base: 0.5, drift: -0.008, alpha: 0.3 },
    ],
    ground: season("autumn", "#4a3118", 0.82),
    slabs: [
      { k: "clay", x: 0.14, y: 0.66, s: 0.27 },
      { k: "tan", x: 0.86, y: 0.6, s: 0.26, f: true },
      { k: "olive", x: 0.5, y: 0.34, s: 0.19 },
    ],
    items: [
      { k: "cart", x: 0.16, y: 0.66, h: 0.12 },
      { k: "tree", x: 0.88, y: 0.6, h: 0.17, f: true },
      { k: "sign", x: 0.46, y: 0.34, h: 0.07 },
      { k: "crate", x: 0.66, y: 0.82, h: 0.08 },
    ],
    arcs: [{ x0: 0.24, y0: 0.6, x1: 0.46, y1: 0.34, n: 6, sag: 0.05 }],
    fliers: [{ src: BIRD1(4), x: 0.36, y: 0.18, s: 0.055, rate: 10, drift: 0.02, bob: 0.02 }],
    weather: "leaf",
    wn: 46,
    wtint: "#e08a2e",
  },

  // ── 6 · WHY IT MATTERS — sunset, and coins everywhere ──
  {
    key: "sunset",
    wash: "#c56a1e",
    bands: [
      { src: BG(1), h: 1, base: 1, drift: -0.003 },
      { src: "/neon/city_01.png", h: 0.4, base: 0.88, drift: -0.012, alpha: 0.4 },
    ],
    ground: season("summer", "#2a3a1c", 0.82),
    slabs: [
      { k: "lime", x: 0.14, y: 0.64, s: 0.27 },
      { k: "clay", x: 0.86, y: 0.58, s: 0.27, f: true },
      { k: "olive", x: 0.5, y: 0.32, s: 0.2, f: true },
      { k: "grey", x: 0.32, y: 0.44, s: 0.16 },
    ],
    items: [
      { k: "tree", x: 0.16, y: 0.64, h: 0.18 },
      { k: "bush", x: 0.88, y: 0.58, h: 0.1, f: true },
      { k: "barrel", x: 0.7, y: 0.82, h: 0.11 },
    ],
    arcs: [
      { x0: 0.2, y0: 0.58, x1: 0.34, y1: 0.42, n: 5, sag: 0.04 },
      { x0: 0.38, y0: 0.42, x1: 0.5, y1: 0.3, n: 5, sag: 0.03 },
      { x0: 0.54, y0: 0.3, x1: 0.84, y1: 0.55, n: 8, sag: 0.06 },
    ],
    fliers: [
      { src: BIRD1(2), x: 0.26, y: 0.16, s: 0.06, rate: 11, drift: 0.024, bob: 0.022 },
      { src: BIRD1(5), x: 0.62, y: 0.1, s: 0.045, rate: 9, drift: 0.018, bob: 0.028 },
      { src: BIRD2(3), x: 0.86, y: 0.2, s: 0.038, rate: 13, drift: -0.014, bob: 0.02 },
    ],
    weather: "ember",
    wn: 52,
    wtint: "#ffd76a",
  },
];
