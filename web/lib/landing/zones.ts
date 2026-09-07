/**
 * THE SIX WORLDS, as data.
 *
 * The landing page is one continuous side-scrolling strip six viewports wide, and
 * this table is the whole of what changes as you travel it. Nothing here is a
 * decision the renderer makes — it reads this and paints it.
 *
 *   0  night      the page opens here, almost unlit
 *   1  industry   the machine that runs the Plan
 *   2  winter     draw mode
 *   3  summer     grid mode
 *   4  neon       flappy mode
 *   5  mixed      all four materials, converging under the device
 *
 * Each zone owns exactly one viewport of world. A layer's `par` is its parallax as
 * a fraction of the travelled distance: 0 is painted on the sky and never moves, 1
 * is nailed to the ground and moves with your feet.
 */

export const ZONES_N = 6;

export interface ZoneLayer {
  src: string;
  /** Parallax, as a fraction of world travel. 0 = infinitely far, 1 = underfoot. */
  par: number;
  /** Drawn height and bottom edge, as fractions of viewport height. */
  h: number;
  base: number;
  alpha?: number;
  /** Repeat upward as well as sideways — for a wall rather than a horizon. */
  tileY?: boolean;
}

export interface Zone {
  key: string;
  /** Flat wash under everything: what you see before a sheet has decoded, and the
   *  colour the neighbouring zones blend through. */
  base: [number, number, number];
  layers: ZoneLayer[];
}

export const ZONES: Zone[] = [
  {
    key: "night",
    base: [8, 10, 26],
    layers: [
      { src: "/flappy/background/Background5.png", par: 0.05, h: 1, base: 1 },
      { src: "/neon/city_02.png", par: 0.26, h: 0.46, base: 0.82, alpha: 0.5 },
    ],
  },
  {
    key: "industry",
    base: [26, 26, 34],
    layers: [
      { src: "/industrial/paralax-background.png", par: 0.07, h: 0.62, base: 1, tileY: true, alpha: 0.9 },
      { src: "/industrial/straight-pipe.png", par: 0.34, h: 0.1, base: 0.8, alpha: 0.85 },
    ],
  },
  {
    key: "winter",
    base: [120, 158, 176],
    layers: [{ src: "/flappy/background/Background2.png", par: 0.05, h: 1, base: 1 }],
  },
  {
    key: "summer",
    base: [86, 150, 108],
    layers: [{ src: "/flappy/background/Background7.png", par: 0.05, h: 1, base: 1 }],
  },
  {
    key: "neon",
    base: [22, 12, 40],
    layers: [
      { src: "/neon/Cloud2.png", par: 0.08, h: 0.5, base: 0.62, alpha: 0.75 },
      { src: "/neon/city_02.png", par: 0.18, h: 0.46, base: 0.86 },
      { src: "/neon/Cloud1.png", par: 0.28, h: 0.42, base: 0.56, alpha: 0.8 },
      { src: "/neon/city_01.png", par: 0.4, h: 0.5, base: 0.94 },
      { src: "/neon/BG_fog.png", par: 0.5, h: 0.4, base: 1, alpha: 0.5 },
    ],
  },
  {
    key: "mixed",
    base: [58, 40, 34],
    layers: [
      { src: "/flappy/background/Background1.png", par: 0.05, h: 1, base: 1 },
      { src: "/neon/city_01.png", par: 0.3, h: 0.4, base: 0.86, alpha: 0.4 },
    ],
  },
];

/**
 * How present each zone is at a given world position.
 *
 * `at` is measured in VIEWPORT WIDTHS travelled, not in scroll fraction, because
 * every page now walks a different stretch of the same world at a different length.
 * Zone `i` is at full strength when `at` is `i`, and adjacent zones always sum to 1 —
 * which is what stops the crossfade dipping through the backdrop colour halfway
 * between two worlds.
 */
export function zoneWeight(at: number, i: number): number {
  return Math.max(0, 1 - Math.abs(at - i));
}

/** Which zone owns a point in world space, where one zone is one viewport wide. */
export function zoneAt(worldX: number, W: number): number {
  return Math.min(ZONES_N - 1, Math.max(0, Math.floor(worldX / W)));
}
