/**
 * The stage palette.
 *
 * Two families that must never be confused:
 *
 *   LANE colours are decoration. They separate the four BTC resolutions from each
 *   other and carry no meaning beyond "this is a different interval".
 *
 *   STATE colours are meaning. UP/DOWN and won/lost/open ride on them, and they are
 *   the only colours allowed on a Leg. Nothing decorative may reuse them, or a
 *   viewer will read a lane tint as an outcome.
 */

/** Near-black violet. The ground the whole scene is lit against. */
export const GROUND = 0x0f0a1e;

/** Floor grid. Two weights so the Window boundaries read louder than the ticks. */
export const GRID_FAINT = 0x2a1f4d;
export const GRID_WINDOW = 0x4a3a7d;

/** Lane tints, nearest first: 15m, 1h, 4h, 24h. Decorative only. */
export const LANE = [0xff6ad5, 0xa06bff, 0x6bb8ff, 0x8f7fd4] as const;

/** Meaning. Gold is KURVV's accent and marks the live/armed state. */
export const STATE = {
  up: 0x6bffc4,
  down: 0xff6a7a,
  gold: 0xf0a030,
  won: 0x6bffc4,
  lost: 0xff6a7a,
  pending: 0x4a4368,
  skipped: 0x33304a,
  /** The drawn Curve before it is committed — the user's own line. */
  curve: 0x6bffe0,
} as const;

/** Clear-skin console. Transmission does the work; these only tint it. */
export const SHELL = {
  body: 0xd7dade,
  back: 0xeef1f3,
  knob: 0xeef0f3,
  /** The click wheel face. */
  wheel: 0x2b2f36,
  main: 0xe5322b,
  action: 0x171a20,
  pills: 0x13151a,
  label: 0xc8d0da,
  /** Visible internals, only shown because the shell is transmissive. */
  guts: 0x1d222b,
  board: 0x0a2019,
  gold: 0xd8b45a,
} as const;
