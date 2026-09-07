import { MAIN_H, MAIN_W } from "./screen";
import { PIXEL_ROWS, type PixelCells } from "./pixel";
import { loadSprite, ready } from "./sprites";
import { FUTURE_FRACTION, type Bucket } from "./three/buckets";
import type { DrawPoint, LegRenderState, LegView } from "./render/types";

/**
 * THE CHART SCREEN, DRAWN 2D.
 *
 * Draw mode and grid mode used to be geometry inside an orbiting perspective scene.
 * They are flat now, for the same reason flappy is: the screen has one job — say
 * where the price has been, where you think it is going, and what the chain did
 * about it — and a camera the user can rotate makes every one of those harder to
 * read. The device itself is still 3D; only its screen content is flat.
 *
 * A CONSEQUENCE WORTH NAMING: the touch mapping stops being a projection. A hit on
 * the glass is a UV, the canvas is the screen, so `uvToPlot` is two divisions. The
 * old path projected the drawable rect through the CHART camera and normalised
 * inside it, and getting that camera wrong silently put every stroke in the wrong
 * place. That whole class of bug is gone.
 *
 * THERE IS NO SKY AND NO GROUND LINE. The backdrop is four parallax bands of
 * terrain, each running from its own crest to the bottom of the frame at its own
 * speed and its own haze. A single ground strip under an empty sky put four fifths
 * of the screen behind nothing at all; bands fill the frame and still leave the
 * price line the only high-contrast thing on it.
 */



/**
 * THE THEME IS THE MODE, not the skin.
 *
 * The three modes are three different games and were reading as one screen with the
 * furniture rearranged. Worse, all three sat under the same near-black wash, so the
 * source art's bright pixel palette arrived on screen looking like a badly calibrated
 * monitor rather than a deliberate colour. Flappy escaped that only because it draws
 * its own full-bleed sky and never used this wash at all — which is exactly why it
 * was the one that looked right.
 *
 * So each mode gets a season AND a palette, and the wash is tinted rather than
 * neutral: colour, not grey, is what makes a dark screen read as a choice.
 *
 *  draw   night / neon  — indigo over the autumn sheet, magenta and cyan line work
 *  pixel  winter        — cold slate over the winter sheet, ice-blue lattice
 *  flappy summer        — untouched; `flappyScene` owns its own sky
 *
 * The skin still recolours the device and the Legs. It no longer picks the world,
 * because two independent things were choosing the same variable and the mode is the
 * one a player is actually looking at.
 */
export interface ChartTheme {
  /** Which scene the mode paints. */
  backdrop: "neon" | "industrial";
  /** Tint over the future span, marking it as a region. */
  future: string;
  /** The price line, and the glow it throws. */
  line: string;
  glow: string;
  /** Window separators and the `now` edge. */
  grid: string;
  edge: string;
  /** Grid mode's plate and lattice. */
  plate: string;
  lattice: string;
}

export const THEMES: Record<"draw" | "pixel" | "flappy", ChartTheme> = {
  // Autumn's sheet is the darkest of the four, which is what lets an indigo wash
  // read as night rather than as a green field with the lights off.
  draw: {
    backdrop: "neon",
    future: "rgba(10,4,30,.24)",
    line: "#37f5ff",
    glow: "rgba(55,245,255,.30)",
    grid: "rgba(190,120,255,.20)",
    edge: "rgba(255,90,220,.70)",
    plate: "rgba(10,6,28,.55)",
    lattice: "rgba(190,120,255,.22)",
  },
  pixel: {
    backdrop: "industrial",
    future: "rgba(255,150,40,.05)",
    // HAZARD ORANGE, which is this pack's signature and nothing else on the device
    // uses. Two dark scenes need different hues, or the second reads as the first
    // with the lights changed.
    line: "#ffab40",
    glow: "rgba(255,171,64,.34)",
    grid: "rgba(196,206,232,.20)",
    edge: "rgba(255,171,64,.72)",
    // NO PLATE. A white rectangle under the lattice was an overlay by another name.
    // The wall behind the grid is already flat and dark, which is the whole reason
    // that backdrop is built the way it is.
    plate: "rgba(0,0,0,0)",
    lattice: "rgba(206,216,238,.26)",
  },
  // Flappy never reaches this renderer, but a mode without an entry would be a
  // lookup that silently falls back rather than a compile error.
  flappy: {
    backdrop: "neon",
    future: "rgba(10,9,20,.20)",
    line: "#6bffe0",
    glow: "rgba(107,255,224,.28)",
    grid: "rgba(255,255,255,.13)",
    edge: "rgba(255,255,255,.5)",
    plate: "rgba(8,7,14,.50)",
    lattice: "rgba(255,255,255,.16)",
  },
};


/**
 * Where a Curve may be drawn, in canvas pixels.
 *
 * The FUTURE span only — the left of the screen is history and cannot be bet on.
 * Exported because the hit test and the renderer must agree; a second copy of these
 * numbers is exactly how a stroke ends up somewhere the user did not draw it.
 */
export const PLOT = {
  // Derived, never typed twice: the bucketiser fills the history side.
  x0: Math.round(MAIN_W * (1 - FUTURE_FRACTION)),
  x1: MAIN_W - 16,
  y0: 84,
  y1: Math.round(MAIN_H * 0.86),
};

/** A hit on the glass, as a point in the drawable span. `uv.y` is bottom-up. */
export function uvToPlot(ux: number, uy: number): DrawPoint {
  const cx = ux * MAIN_W;
  const cy = (1 - uy) * MAIN_H;
  const u = (cx - PLOT.x0) / Math.max(PLOT.x1 - PLOT.x0, 1e-6);
  const v = (PLOT.y1 - cy) / Math.max(PLOT.y1 - PLOT.y0, 1e-6);
  return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
}

/**
 * Which columns a grid's Legs came from.
 *
 * `legs[k]` was painted at `columnsOf(cells)[k]`. Derived here rather than passed in,
 * because it is the SAME derivation `cellsToPlan` does — ascending painted columns —
 * and two copies of it drifting apart would draw a Leg's result on somebody else's
 * Window.
 */
export function columnsOf(cells: PixelCells): number[] {
  const out: number[] = [];
  cells.forEach((c, i) => { if (c !== undefined && c !== 0) out.push(i); });
  return out;
}

export interface ChartSceneState {
  buckets: Bucket[];
  /**
   * The newest raw fill, UNBUCKETED — what the ticker actually reads.
   *
   * The buckets are a RESOLUTION choice and scale with the horizon: 5s on the 60s
   * venue but **30s on the 5-minute one and 300s on the hourly**. So the drawn line
   * cannot step more often than that, and on a 5-minute Window the head appeared to
   * freeze for half a minute at a time even though the spot book prints every ~10s
   * and the poll runs at 1.5s. Nothing was stale; the display was quantised.
   *
   * History stays bucketed — that is what keeps a long span readable. Only the head
   * bead and the level line it throws forward use the live print, because those are
   * the two marks a viewer reads as "the current price".
   */
  last: { t: number; price: number } | null;
  extent: { lo: number; hi: number };
  now: number;
  horizonSec: number;
  legs: LegView[];
  planStart: number | null;
  /** Every drawn Curve, oldest first. The last is the live one. */
  curves: DrawPoint[][] | null;
  /** Grid mode's painted cells, or null in draw mode. */
  cells: PixelCells | null;
  legCount: number;
  /**
   * WHEN COLUMN 0 OF THE PLAN BEGINS, as a unix second — or null for a plan that is
   * not anchored in time yet.
   *
   * This is what makes the board SCROLL. Plan content used to be laid out by column
   * index against a fixed span, so a drawn Curve sat still while the price walked
   * underneath it and the relationship between the two was left to the viewer to
   * imagine. Anchored in time, every Leg has a real position on the timeline: `now`
   * stays put and the Plan slides left through it, so a Window that has elapsed ends
   * up over the price that actually happened during it.
   */
  anchor: number | null;
  /** The mode's palette and season. See `THEMES`. */
  theme: ChartTheme;
  /** Committed Plan, for the strip along the bottom. */
  plan: { direction: "UP" | "DOWN"; stake: bigint }[];
  synthetic: number;
}

export interface ChartScene {
  draw: (ctx: CanvasRenderingContext2D, s: ChartSceneState, elapsed: number) => void;
  dispose: () => void;
}

/** A marker's animation clock: the state it is in, and when it entered it. */
interface Mark { state: LegRenderState | "idle"; at: number }

/** Frames in `coin_.png`, a 192x16 strip. */
const COIN_FRAMES = 12;

export function createChartScene(): ChartScene {
  let disposed = false;
  const coin = loadSprite("/world/objects/coin_.png");
  // Draw mode's world. Silhouettes on transparency, so the sky behind them is ours.
  const neonCityFar = loadSprite("/neon/city_02.png");
  const neonCityNear = loadSprite("/neon/city_01.png");
  const neonCloudFar = loadSprite("/neon/Cloud2.png");
  const neonCloudNear = loadSprite("/neon/Cloud1.png");
  const neonFog = loadSprite("/neon/BG_fog.png");
  const neonTiles = loadSprite("/neon/tiles_16x16.png");
  // Grid mode's world.
  const indWall = loadSprite("/industrial/paralax-background.png");
  const indTiles = loadSprite("/industrial/industrial-tileset.png");
  const indPipe = loadSprite("/industrial/straight-pipe.png");

  /**
   * DRAW MODE — a neon city at night, drawn at full strength.
   *
   * Back to front: sky, far clouds, far skyline, near skyline, fog, street. The two
   * skyline sheets are the same buildings in two values, so putting the darker one
   * behind and offsetting its speed is what makes depth out of two files.
   *
   * The data sits in the upper-middle of the frame, which is sky here — a flat, dark,
   * untextured field. That is the legibility mechanism now, in place of the wash: the
   * busy part of the picture is the skyline along the bottom, below everything the
   * chart draws.
   */
  const neonBackdrop = (ctx: CanvasRenderingContext2D, elapsed: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, MAIN_H);
    sky.addColorStop(0, "#0d0722");
    sky.addColorStop(0.5, "#1b0f3a");
    sky.addColorStop(1, "#33164a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, MAIN_W, MAIN_H);

    // THE PACK AT ITS OWN SIZE. Scaling these sheets to fractions of the canvas made
    // each building 200px wide and the skyline swallowed the plot — the layers were
    // the right layers at the wrong scale. They are authored around a 320x180 view
    // (`BG_fog.png` is exactly that), so they get an INTEGER pixel scale and are
    // tiled to fill, which is how the pack is meant to be used and the only way the
    // nearest-neighbour upscale stays crisp.
    //
    // Everything sits BELOW the plot. `PLOT.y1` is the floor of the drawable area, so
    // the skyline's crest starts under it and the data never competes with a window
    // ledge. The two city sheets are the same buildings in two values: the LIGHTER
    // one goes far — at night a city's distance reads as haze, not as darkness — and
    // the darker one near, which also puts the heaviest mass at the very bottom.
    const K = 2;
    const street = MAIN_H - 16 * K * 2;

    const layer = (
      img: HTMLImageElement | null, bottom: number, speed: number, alpha = 1,
    ) => {
      if (!ready(img)) return;
      const w = img.naturalWidth * K;
      const h = img.naturalHeight * K;
      const y = Math.round(bottom - h);
      const shift = Math.floor((elapsed * speed) % w);
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let x = -w - shift; x < MAIN_W + w; x += w) ctx.drawImage(img, Math.round(x), y, w, h);
      ctx.restore();
    };

    layer(neonCloudFar, street - 150, 4, 0.20);
    layer(neonCloudNear, street - 90, 7, 0.16);
    layer(neonCityNear, street + 40, 6);
    layer(neonCityFar, street + 96, 12);
    layer(neonFog, street + 30, 16, 0.45);

    // The street. `(16,0)` is the surface row and `(16,16)` the interior below it.
    if (ready(neonTiles)) {
      const step = 16 * K;
      const shift = Math.floor((elapsed * 20) % step);
      for (let x = -step - shift; x < MAIN_W + step; x += step) {
        ctx.drawImage(neonTiles, 16, 0, 16, 16, Math.round(x), street, step, step);
        ctx.drawImage(neonTiles, 16, 16, 16, 16, Math.round(x), street + step, step, step);
      }
    }
  };

  /**
   * GRID MODE — an industrial facility.
   *
   * Not winter. The board is a lattice of thirteen hairlines, and the one thing it
   * cannot survive is a busy backdrop: snow tiles under the grid made the grid
   * disappear, and no amount of recolouring fixes texture sitting behind fine lines.
   * So this scene is built the other way round — a FLAT, DARK, QUIET wall across the
   * whole plot, with everything textured pushed outside it.
   *
   * The pack's own parallax wall is exactly that: dark, low-contrast, small windows.
   * The steel floor goes below `PLOT.y1` and the pipe run above `PLOT.y0`, so the
   * band the grid occupies is the plainest part of the picture by construction.
   *
   * Hazard orange is the mode's signature. Draw mode owns purple and cyan and flappy
   * owns daylight blue; a third dark scene needs its own hue or it reads as draw mode
   * with the lights changed.
   */
  const industrialBackdrop = (ctx: CanvasRenderingContext2D, elapsed: number) => {
    const sky = ctx.createLinearGradient(0, 0, 0, MAIN_H);
    sky.addColorStop(0, "#1a1c2b");
    sky.addColorStop(0.6, "#232538");
    sky.addColorStop(1, "#2c2f45");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, MAIN_W, MAIN_H);

    const K = 3;
    const floor = MAIN_H - 16 * K * 2;

    // The wall, drifting slowly. Dimmed a little because it is a backdrop for a
    // lattice, not a scene in its own right.
    if (ready(indWall)) {
      const w = indWall.naturalWidth * K;
      const h = indWall.naturalHeight * K;
      const shift = Math.floor((elapsed * 5) % w);
      ctx.save();
      // Quiet. The lattice is thirteen hairlines and the wall is behind them, so it
      // is texture at a third strength rather than a picture at full.
      ctx.globalAlpha = 0.3;
      for (let x = -w - shift; x < MAIN_W + w; x += w) {
        for (let y = floor - h; y > -h; y -= h) ctx.drawImage(indWall, Math.round(x), y, w, h);
      }
      ctx.restore();
    }

    // The pipe run, above the plot.
    if (ready(indPipe) && PLOT.y0 > 24) {
      const w = indPipe.naturalWidth * 2;
      const h = indPipe.naturalHeight * 2;
      const shift = Math.floor((elapsed * 9) % w);
      for (let x = -w - shift; x < MAIN_W + w; x += w) {
        ctx.drawImage(indPipe, Math.round(x), PLOT.y0 - h - 6, w, h);
      }
    }

    // The steel floor, below the plot. `(0,0)` is a plain plated block and `(0,32)`
    // the hazard-striped edge that caps it.
    if (ready(indTiles)) {
      const step = 16 * K;
      const shift = Math.floor((elapsed * 16) % step);
      for (let x = -step - shift; x < MAIN_W + step; x += step) {
        ctx.drawImage(indTiles, 0, 32, 16, 16, Math.round(x), floor, step, step);
        ctx.drawImage(indTiles, 0, 0, 16, 16, Math.round(x), floor + step, step, step);
      }
    }
  };

  /**
   * When each grid column's marker last changed state.
   *
   * A win RISES and a loss POPS, and both are one-shot: they need a start time, and
   * nothing upstream has one — a Leg's `state` says what it is, never when it became
   * that. Keyed by column, and render-local on purpose, because it describes the
   * picture rather than the Plan.
   */
  const marks = new Map<number, Mark>();

  const draw = (ctx: CanvasRenderingContext2D, s: ChartSceneState, elapsed: number) => {
    if (disposed) return;
    ctx.imageSmoothingEnabled = false;

    // ── the backdrop ───────────────────────────────────────────────────────
    //
    // NO SCRIM. There used to be a near-black wash over every mode, and it was the
    // reason the art looked wrong: pixel palettes are chosen for saturation, and a
    // 30-50% black layer turns a deliberate colour into a washed grey that reads as
    // a badly calibrated screen. Flappy escaped it only because it draws its own
    // full-bleed sky and never went through here — which is exactly why flappy was
    // the mode that looked right.
    //
    // So each mode now draws its OWN scene at full strength, and legibility comes
    // from choosing art whose quiet regions are where the data lives, not from
    // dimming art that was never the problem.
    if (s.theme.backdrop === "neon") neonBackdrop(ctx, elapsed);
    else industrialBackdrop(ctx, elapsed);

    const { lo, hi } = s.extent;
    const span = Math.max(hi - lo, 1e-9);
    const Y = (price: number) =>
      PLOT.y1 - ((price - lo) / span) * (PLOT.y1 - PLOT.y0);
    const cols = Math.max(s.legCount, 1);
    const PW = PLOT.x1 - PLOT.x0;
    /**
     * How far the Plan has slid, in plan-widths. 0 at the instant it is anchored,
     * going negative as time passes. `X(u)` is the only place plan coordinates
     * become pixels — the Curve, the cells, the Leg blocks and the Window lines all
     * go through it, so they cannot drift apart.
     */
    const off = s.anchor === null ? 0 : (s.anchor - s.now) / Math.max(s.horizonSec, 1);
    const X = (u: number) => PLOT.x0 + (u + off) * PW;

    // ── the future span, as a PLACE ────────────────────────────────────────
    //
    // The Window grid used to be twelve hairlines starting abruptly in mid-screen
    // over unbroken terrain, which reads as a rendering fault rather than as a board.
    // Nothing said where the future began or that the lines belonged to it. Three
    // things fix that and none of them are decoration: the span is tinted so it is a
    // region, `now` is a real edge, and the edge is labelled.
    ctx.save();
    ctx.fillStyle = s.theme.future;
    ctx.fillRect(PLOT.x0, 0, MAIN_W - PLOT.x0, MAIN_H);

    // The Window separators belong to the PLAN, so they travel with it. Drawn from
    // -1 so a column that has scrolled left of `now` keeps its edges while it is
    // still on screen, and clipped to the plot so nothing escapes into the history.
    ctx.save();
    ctx.beginPath();
    ctx.rect(8, 0, PLOT.x1 - 8, MAIN_H);
    ctx.clip();
    ctx.strokeStyle = s.theme.grid;
    ctx.lineWidth = 2;
    for (let i = -cols; i <= cols; i++) {
      const x = Math.round(X(i / cols)) + 0.5;
      if (x < 8 || x > PLOT.x1) continue;
      ctx.beginPath();
      ctx.moveTo(x, PLOT.y0);
      ctx.lineTo(x, PLOT.y1);
      ctx.stroke();
    }
    ctx.restore();

    // `now`: the boundary between what happened and what can be bet on. Full height,
    // brighter than the Window lines, and the only labelled thing on the backdrop.
    const nx = Math.round(PLOT.x0) + 0.5;
    ctx.strokeStyle = s.theme.edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nx, 0);
    ctx.lineTo(nx, MAIN_H);
    ctx.stroke();
    ctx.fillStyle = s.theme.edge;
    ctx.font = "800 17px ui-monospace, Menlo, monospace";
    ctx.fillText("NOW", nx + 10, 30);
    ctx.textAlign = "right";
    ctx.fillText("PAST", nx - 10, 30);
    ctx.textAlign = "left";
    ctx.restore();

    // ── the price line ─────────────────────────────────────────────────────
    if (s.buckets.length > 1) {
      const first = s.buckets[0].t;
      const histX = (t: number) =>
        8 + ((t - first) / Math.max(s.now - first, 1)) * (PLOT.x0 - 8);
      ctx.save();
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.strokeStyle = s.theme.line;
      ctx.lineWidth = 4;
      ctx.beginPath();
      s.buckets.forEach((b, i) => {
        const x = histX(b.t);
        const y = Y(b.close);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      // Carry the line to the live print, otherwise the bead detaches from its own
      // trace for up to one bucket — a floating dot beside a line that stops short.
      if (s.last) ctx.lineTo(PLOT.x0, Y(s.last.price));
      ctx.stroke();

      // The head: a bead on the last print, and the level it sets running forward.
      // The LIVE print when there is one — see `last` on the state.
      const head = s.buckets[s.buckets.length - 1];
      const hy = Y(s.last ? s.last.price : head.close);
      ctx.setLineDash([10, 9]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = s.theme.glow;
      ctx.beginPath();
      ctx.moveTo(PLOT.x0, hy);
      ctx.lineTo(PLOT.x1, hy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = s.theme.line;
      ctx.beginPath();
      ctx.arc(PLOT.x0, hy, 7 + Math.sin(elapsed * 3.1) * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── the Legs the chain actually opened ─────────────────────────────────
    // Draw mode only: in grid mode the markers carry the outcome themselves, and a
    // second row of coloured plates saying the same thing is just clutter.
    if (s.planStart !== null && s.legs.length && !s.cells) {
      const perLeg = PW / cols;
      s.legs.forEach((leg, i) => {
        const x = X(i / cols);
        ctx.save();
        ctx.globalAlpha = leg.state === "pending" ? 0.4 : 0.82;
        ctx.fillStyle = toneOf(leg.state, leg.direction);
        const h = 26;
        const y = leg.direction === "UP" ? PLOT.y0 + 12 : PLOT.y1 - 12 - h;
        ctx.fillRect(Math.round(x + 6), y, Math.round(perLeg - 12), h);
        ctx.restore();
      });
    }

    // ── grid mode ──────────────────────────────────────────────────────────
    if (s.cells) {
      const cw = PW / cols;
      const rows = PIXEL_ROWS * 2 + 1;
      const rh = (PLOT.y1 - PLOT.y0) / rows;
      const midY = PLOT.y0 + PIXEL_ROWS * rh;
      ctx.save();
      // A plate under the board. Thirteen hairlines over four bands of tiled terrain
      // is thirteen invisible hairlines; the grid has to sit ON something.
      //
      // FULL BLEED, not `PLOT`-sized. Painting only the board's own rectangle left a
      // hard four-sided seam with bright terrain outside it, so the board read as a
      // dialog dropped onto the artwork rather than as the screen's content. The
      // scenery still shows through at 0.62 — it is a backdrop, not a competitor.
      ctx.fillStyle = s.theme.plate;
      ctx.fillRect(0, 0, MAIN_W, MAIN_H);
      // The lattice, so an unpainted board still says what the moves are.
      ctx.strokeStyle = s.theme.lattice;
      ctx.lineWidth = 1;
      for (let r = 0; r <= rows; r++) {
        const y = Math.round(PLOT.y0 + r * rh) + 0.5;
        ctx.beginPath();
        ctx.moveTo(PLOT.x0, y);
        ctx.lineTo(PLOT.x1, y);
        ctx.stroke();
      }
      // The centre row is SKIP, and is marked as such — it is not a small bet.
      ctx.fillStyle = "rgba(255,255,255,.09)";
      ctx.fillRect(PLOT.x0, midY, PLOT.x1 - PLOT.x0, rh);
      ctx.restore();

      // Which Leg belongs to which column. Legs exist only once a Plan is committed;
      // before that every marker is idle and simply spins.
      const painted = columnsOf(s.cells);
      const stateOf = (col: number): LegRenderState | "idle" => {
        const k = painted.indexOf(col);
        return k >= 0 && s.legs[k] ? s.legs[k].state : "idle";
      };

      s.cells.forEach((cell, c) => {
        if (cell === undefined || cell === 0 || c >= cols) return;
        const state = stateOf(c);
        const prev = marks.get(c);
        if (!prev || prev.state !== state) marks.set(c, { state, at: elapsed });
        const age = elapsed - (marks.get(c)?.at ?? elapsed);

        const cx = X((c + 0.5) / cols);
        // Distance from the centre IS the conviction, so the marker's row is the bet.
        const cy = midY + rh / 2 - cell * rh;
        drawMarker(ctx, coin, cx, cy, midY + rh / 2,
          Math.min(rh * 1.6, cw * 0.7), state, age, elapsed, cell > 0);
      });
    }

    // ── the drawn Curves ───────────────────────────────────────────────────
    if (s.curves?.length && !s.cells) {
      const V = (v: number) => PLOT.y1 - v * (PLOT.y1 - PLOT.y0);
      s.curves.forEach((c, i) => {
        if (c.length < 2) return;
        const live = i === s.curves!.length - 1;
        ctx.save();
        ctx.lineJoin = ctx.lineCap = "round";
        // Earlier Curves stay to compare against, but dimmed and dotted: only the
        // newest one is the Plan that would commit.
        ctx.strokeStyle = live ? "#ffd45e" : "rgba(255,212,94,.34)";
        ctx.lineWidth = live ? 6 : 3;
        if (!live) ctx.setLineDash([8, 8]);
        ctx.beginPath();
        c.forEach((p, k) => {
          const x = X(p.u);
          const y = V(p.v);
          k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        if (live) {
          const end = c[c.length - 1];
          ctx.fillStyle = "#ffd45e";
          ctx.beginPath();
          ctx.arc(X(end.u), V(end.v), 9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    // ── the Plan strip ─────────────────────────────────────────────────────
    if (s.plan.length) planStrip(ctx, s.plan, s.synthetic);
  };

  return { draw, dispose: () => { disposed = true; marks.clear(); } };
}

function toneOf(state: LegRenderState, direction: "UP" | "DOWN"): string {
  return state === "won" ? "#6bffc4"
    : state === "lost" ? "#ff6a7a"
    : state === "open" ? "#ffd45e"
    : state === "skipped" || state === "void" ? "#6f6a8c"
    : direction === "UP" ? "#7ce0ff" : "#c78bff";
}

/**
 * One painted cell, as a coin.
 *
 * The coin IS the bet. It spins where you put it while the Window is undecided, and
 * the two outcomes are the two things that can happen to a coin: a winner RISES out
 * of the frame, a loser POPS.
 *
 * The pack has no burst frames, so the pop is improvised — the coin shrinks and four
 * shards leave it. Said out loud because it is the one thing on this screen not
 * taken from the artwork, and a reader should not have to infer that from the
 * absence of a sheet.
 */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  coin: HTMLImageElement | null,
  cx: number, cy: number, baseY: number, size: number,
  state: LegRenderState | "idle", age: number, elapsed: number, up: boolean,
) {
  const S = Math.max(18, Math.round(size));

  // The stem back to the centre line, so distance-from-centre still reads as size
  // once the cell is a marker rather than a bar.
  ctx.save();
  ctx.strokeStyle = up ? "rgba(124,224,255,.5)" : "rgba(199,139,255,.5)";
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.restore();

  /**
   * THE OUTCOME OUTLIVES THE ANIMATION.
   *
   * A win rose out of frame and a loss popped, and both left the cell EMPTY. The
   * animation is under a second and the Windows it grades are minutes apart, so a
   * player who looked away for a moment came back to a blank board and concluded
   * nothing had happened — the one thing the screen most needs to say is the thing it
   * was erasing. A settled cell now keeps a quiet mark for as long as it is on
   * screen; the animation is the announcement, this is the record.
   */
  const residue = (tone: string, filled: boolean) => {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = tone;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    if (filled) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = tone;
      ctx.fill();
    }
    ctx.restore();
  };

  if (state === "lost") {
    // POP, then a dim ring where the coin was.
    const t = Math.min(age / 0.45, 1);
    if (t >= 1) { residue("#ff6a7a", false); return; }
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = "#ff6a7a";
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const d = t * S * 1.3;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(1, S * 0.16 * (1 - t)), 0, Math.PI * 2);
      ctx.fill();
    }
    if (t < 1 && ready(coin)) {
      const k = S * (1 - t * 0.6);
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.drawImage(coin, 0, 0, 16, 16, cx - k / 2, cy - k / 2, k, k);
    }
    ctx.restore();
    return;
  }

  let y = cy;
  let alpha = 1;
  if (state === "won") {
    // RISE. Eases out of the frame and stays gone — a settled winner is money, and
    // money leaving the board is the clearest thing this screen can say.
    const t = Math.min(age / 1.1, 1);
    if (t >= 1) { residue("#6bffc4", true); return; }
    y = cy - t * t * (cy + S);
    alpha = 1 - Math.max(0, t - 0.7) / 0.3;
  } else if (state === "void" || state === "skipped") {
    alpha = 0.35;
  }
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (ready(coin)) {
    // Spinning while undecided, held still once it is not: a coin still turning on a
    // settled Window would say the question is open when it is closed.
    const spin = state === "idle" || state === "pending" || state === "open";
    const f = spin ? Math.floor(elapsed * 12 + cx * 0.05) % COIN_FRAMES : 0;
    ctx.drawImage(coin, f * 16, 0, 16, 16, Math.round(cx - S / 2), Math.round(y - S / 2), S, S);
  } else {
    ctx.fillStyle = up ? "#7ce0ff" : "#c78bff";
    ctx.beginPath();
    ctx.arc(cx, y, S / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function planStrip(
  ctx: CanvasRenderingContext2D,
  plan: { direction: "UP" | "DOWN"; stake: bigint }[],
  synthetic: number,
) {
  const h = 66;
  const y = MAIN_H - h - 14;
  ctx.save();
  ctx.fillStyle = "rgba(14,12,24,.86)";
  ctx.strokeStyle = "rgba(255,255,255,.1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(16, y, MAIN_W - 32, h, 24);
  ctx.fill();
  ctx.stroke();
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#6b6486";
  ctx.font = "700 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`PLAN · ${plan.length} LEGS`, 44, y + h / 2);

  // The autonomy count belongs on the chart, not only on its own channel: the claim
  // has to be visible while the chart is up or the viewer never learns to look.
  if (synthetic > 0) {
    const label = `${synthetic} VALIDATOR FIRE${synthetic === 1 ? "" : "S"}`;
    ctx.font = "800 20px ui-monospace, Menlo, monospace";
    const bw = ctx.measureText(label).width + 32;
    ctx.fillStyle = "rgba(107,255,224,.14)";
    ctx.beginPath();
    ctx.roundRect(MAIN_W - 44 - bw, y + h / 2 - 19, bw, 38, 19);
    ctx.fill();
    ctx.fillStyle = "#6bffe0";
    ctx.fillText(label, MAIN_W - 44 - bw + 16, y + h / 2 + 1);
  }
  ctx.restore();
}
