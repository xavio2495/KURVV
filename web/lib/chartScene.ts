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

/** Tile size in every sheet of this pack. */
const T = 16;
/**
 * The terrain rows.
 *
 * `y: 272` is the top row of the leftmost terrain block, verified opaque at the same
 * coordinates in all four season sheets even though two of them are narrower.
 * `y: 288` is the fill row below it.
 */
const SURFACE = { x: 16, y: 272 };
const FILL = { x: 16, y: 288 };

const SEASONS = ["summer", "spring", "autumn", "winter"] as const;

/**
 * The animated near band, from `foreground_.png`.
 *
 * Seven colours down the sheet, EIGHT FRAMES across each — measured, not assumed:
 * the opaque pixel count per cell runs 96, 90, 80, 70, 64, 70, 80, 90, which is one
 * wave rising and falling and could not be a horizontal tiling. Row 7 holds the
 * matching solid fill for each colour, so the band below the crest is the artwork's
 * own colour rather than one picked to look close.
 */
const FORE = { frames: 8, fillRow: 7 };
/** Which colour band each season wears. Indexes rows of `foreground_.png`. */
const FORE_ROW = [6, 0, 2, 3];

/**
 * The parallax stack, far to near.
 *
 * `top` is the crest as a fraction of the frame; each band fills from there to the
 * bottom, so nearer bands bury the ones behind and no gap can open between them.
 * `haze` is how much black goes over the band once it is drawn — aerial perspective,
 * which is what makes four bands of the same tiles read as distance rather than as
 * repetition. `speed` is a fraction of the near band's scroll.
 */
const BANDS = [
  { top: 0.0, speed: 0.05, scale: 2, haze: 0.8, season: false },
  { top: 0.32, speed: 0.13, scale: 2, haze: 0.7, season: false },
  { top: 0.55, speed: 0.26, scale: 3, haze: 0.6, season: true },
  { top: 0.76, speed: 0.48, scale: 4, haze: 0.48, season: true },
] as const;

/** Pixels the near band travels per second. Everything else is a fraction of it. */
const SCROLL = 26;

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
  y1: Math.round(MAIN_H * 0.78),
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
  /** Which season the world wears. Follows the device skin. */
  season: number;
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
  const seasons = SEASONS.map((s) => loadSprite(`/world/seasons/${s}_.png`));
  const objects = loadSprite("/world/objects/staticObjects_.png");
  const dirt = loadSprite("/world/terrain_.png");
  const fore = loadSprite("/world/foreground_.png");
  const coin = loadSprite("/world/objects/coin_.png");

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
    const sheet = seasons[s.season % SEASONS.length];

    // ── the parallax backdrop ──────────────────────────────────────────────
    // Base fill first: a band that has not loaded must not leave the previous frame
    // showing through, and the darkest terrain tone is the right thing to see if
    // none of them ever arrive.
    ctx.fillStyle = "#141018";
    ctx.fillRect(0, 0, MAIN_W, MAIN_H);

    for (const band of BANDS) {
      const src = band.season ? sheet : dirt;
      if (!ready(src)) continue;
      const step = T * band.scale;
      const top = Math.round(MAIN_H * band.top);
      // Scrolled by a whole pixel at a time, so the nearest-neighbour upscale never
      // lands off-grid and shimmers.
      const shift = Math.floor((elapsed * SCROLL * band.speed) % step);
      for (let x = -step - shift; x < MAIN_W + step; x += step) {
        ctx.drawImage(src, SURFACE.x, SURFACE.y, T, T, Math.round(x), top, step, step);
        for (let y = top + step; y < MAIN_H; y += step) {
          ctx.drawImage(src, FILL.x, FILL.y, T, T, Math.round(x), y, step, step);
        }
      }
      if (band.haze > 0) {
        ctx.fillStyle = `rgba(10,8,16,${band.haze})`;
        ctx.fillRect(0, top, MAIN_W, MAIN_H - top);
      }
    }

    // ── decoration, standing on the third band ─────────────────────────────
    // Placed from a fixed pattern rather than at random: a backdrop that reshuffles
    // every frame reads as noise, and one that reshuffles per render is worse.
    if (ready(objects)) {
      const line = Math.round(MAIN_H * BANDS[2].top);
      const drift = elapsed * SCROLL * BANDS[2].speed;
      const wrap = MAIN_W + 200;
      const trees: [number, number, number, number][] = [
        [70, 0, 32, 48], [300, 32, 16, 48], [560, 0, 32, 48], [800, 32, 16, 48],
      ];
      ctx.save();
      ctx.globalAlpha = 0.62;
      for (const [x, sx, sw, sh] of trees) {
        const k = 2.0;
        const px = ((x - drift) % wrap + wrap) % wrap - 100;
        ctx.drawImage(objects, sx, 0, sw, sh, Math.round(px), line - sh * k + 4, sw * k, sh * k);
      }
      ctx.restore();
    }

    // ── the animated near band ─────────────────────────────────────────────
    if (ready(fore)) {
      const row = FORE_ROW[s.season % FORE_ROW.length];
      const frame = Math.floor(elapsed * 7) % FORE.frames;
      const scale = 4;
      const step = T * scale;
      const top = MAIN_H - step * 2;
      const shift = Math.floor((elapsed * SCROLL * 0.7) % step);
      for (let x = -step - shift; x < MAIN_W + step; x += step) {
        ctx.drawImage(fore, frame * T, row * T, T, T, Math.round(x), top, step, step);
        ctx.drawImage(fore, row * T, FORE.fillRow * T, T, T, Math.round(x), top + step, step, step);
      }
    }

    // Everything above is scenery. This is what stops it competing with the data.
    ctx.fillStyle = "rgba(8,7,14,.3)";
    ctx.fillRect(0, 0, MAIN_W, MAIN_H);

    const { lo, hi } = s.extent;
    const span = Math.max(hi - lo, 1e-9);
    const Y = (price: number) =>
      PLOT.y1 - ((price - lo) / span) * (PLOT.y1 - PLOT.y0);
    const cols = Math.max(s.legCount, 1);

    // ── Window grid across the future ──────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.16)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= cols; i++) {
      const x = Math.round(PLOT.x0 + (i / cols) * (PLOT.x1 - PLOT.x0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PLOT.y0);
      ctx.lineTo(x, PLOT.y1);
      ctx.stroke();
    }
    ctx.restore();

    // ── the price line ─────────────────────────────────────────────────────
    if (s.buckets.length > 1) {
      const first = s.buckets[0].t;
      const histX = (t: number) =>
        8 + ((t - first) / Math.max(s.now - first, 1)) * (PLOT.x0 - 8);
      ctx.save();
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.strokeStyle = "#6bffe0";
      ctx.lineWidth = 4;
      ctx.beginPath();
      s.buckets.forEach((b, i) => {
        const x = histX(b.t);
        const y = Y(b.close);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // The head: a bead on the last print, and the level it sets running forward.
      const head = s.buckets[s.buckets.length - 1];
      const hy = Y(head.close);
      ctx.setLineDash([10, 9]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(107,255,224,.55)";
      ctx.beginPath();
      ctx.moveTo(PLOT.x0, hy);
      ctx.lineTo(PLOT.x1, hy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#6bffe0";
      ctx.beginPath();
      ctx.arc(PLOT.x0, hy, 7 + Math.sin(elapsed * 3.1) * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── the Legs the chain actually opened ─────────────────────────────────
    // Draw mode only: in grid mode the markers carry the outcome themselves, and a
    // second row of coloured plates saying the same thing is just clutter.
    if (s.planStart !== null && s.legs.length && !s.cells) {
      const perLeg = (PLOT.x1 - PLOT.x0) / cols;
      s.legs.forEach((leg, i) => {
        const x = PLOT.x0 + i * perLeg;
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
      const cw = (PLOT.x1 - PLOT.x0) / cols;
      const rows = PIXEL_ROWS * 2 + 1;
      const rh = (PLOT.y1 - PLOT.y0) / rows;
      const midY = PLOT.y0 + PIXEL_ROWS * rh;
      ctx.save();
      // A plate under the board. Thirteen hairlines over four bands of tiled terrain
      // is thirteen invisible hairlines; the grid has to sit ON something.
      ctx.fillStyle = "rgba(8,7,14,.52)";
      ctx.fillRect(PLOT.x0, PLOT.y0, PLOT.x1 - PLOT.x0, PLOT.y1 - PLOT.y0);
      // The lattice, so an unpainted board still says what the moves are.
      ctx.strokeStyle = "rgba(255,255,255,.16)";
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

        const cx = PLOT.x0 + (c + 0.5) * cw;
        // Distance from the centre IS the conviction, so the marker's row is the bet.
        const cy = midY + rh / 2 - cell * rh;
        drawMarker(ctx, coin, cx, cy, midY + rh / 2,
          Math.min(rh * 1.6, cw * 0.7), state, age, elapsed, cell > 0);
      });
    }

    // ── the drawn Curves ───────────────────────────────────────────────────
    if (s.curves?.length && !s.cells) {
      const X = (u: number) => PLOT.x0 + u * (PLOT.x1 - PLOT.x0);
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

  if (state === "lost") {
    // POP. Under half a second, then the shards are gone and the cell is empty.
    const t = Math.min(age / 0.45, 1);
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
