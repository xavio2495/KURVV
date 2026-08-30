import { BIRD_U, headAt, type FlappyView, type Verdict } from "./flappy";
import { MAIN_H, MAIN_W } from "./screen";
import { loadSprite, ready } from "./sprites";

/**
 * FLAPPY MODE — drawn 2D, in sprites.
 *
 * The game is a pixel-art game, so it is rendered as pixel art on the device's main
 * display rather than as geometry inside the 3D chart. That is not only a look: the
 * whole point of the mode is to be legible in two seconds, and a lit solid seen
 * through an orbiting perspective camera never was.
 *
 * THE BIRD DOES NOT MOVE ACROSS THE FRAME; THE WORLD DOES. It is pinned at `BIRD_U`
 * and the camera follows it, which is what makes the flight endless rather than a
 * sweep with a start and a finish. The camera lives here, not in the hook: the hook
 * ticks at 16Hz, which is fine for deciding which Windows exist and visibly juddery
 * for scrolling, so the view hands over a wall-clock anchor and this file runs the
 * camera off its own frame clock.
 *
 * WHAT THE PICTURE IS ALLOWED TO SAY. A gate is a HALF-PLANE — one pipe per Window,
 * running from its reference level to the edge of the frame, mouth on the line. The
 * arcade's facing pair with a gap between them is a price BAND, and this venue sells
 * no such contract: there is one question per Window, "at or above this line?", and
 * drawing a gap would be drawing a product that cannot settle. So the sprites are
 * used as single pipes, never as pairs, and the bird being past the mouth on the
 * solid side IS the win — which is what makes "hit" and "won" the same statement.
 *
 * Every sprite is Creative Commons Zero. See `public/flappy/ATTRIBUTION.md`.
 */

/** Native sprite metrics, in the artwork's own pixels. */
const PIPE_CELL = { w: 32, h: 80, cap: 16 };
/**
 * The stretchable middle of the pipe body.
 *
 * Rows 19..60 of every one of the eight colour cells are PIXEL-IDENTICAL — verified
 * across the sheet, not assumed. Because the band is uniform, stretching it to any
 * height is exact rather than approximate, so the shaft is one draw with no seam.
 *
 * Tiling the whole body instead was wrong twice over: rows 16..18 are a lip beneath
 * the cap and 61..79 are the pipe's own closed end, so every tile boundary redrew a
 * lip that read as a SECOND cap partway down the shaft.
 */
const PIPE_BAND = { y: 20, h: 40 };
const PIPE_COLS = 4;
const BIRD_CELL = 16;
const BIRD_FRAMES = 4;
/**
 * The ground strip sits under the pipes on the "simple" sheet.
 *
 * Only the FIRST 64px of it. The 128px strip packs two different terrains side by
 * side — warm dirt, then a pale stone — so tiling the whole width laid down an
 * alternating band that read as a rendering fault rather than as scenery.
 */
const GROUND = { x: 0, y: 80, w: 64, h: 32 };

/**
 * Verdict to pipe colour, by cell index in `PipeStyle1.png`.
 *
 * Read off the sheet: 0 green, 1 orange, 2 red, 3 cyan, 4 grey, 5 magenta, 6 brown,
 * 7 vermilion. Using the artwork's own colours beats tinting a single sprite — a
 * multiplied pixel-art palette goes muddy, and these were designed together.
 */
const PIPE_OF: Record<Verdict, number> = {
  won: 0,
  lost: 2,
  pending: 1,
  void: 4,
  skipped: 4,
};

export interface SceneState {
  view: FlappyView | null;
  /** Shown when the venue publishes no reference level to anchor gates against. */
  unsupported: boolean;
  /** Banner across the top — what the mode is, or how the run did. */
  label: string;
  /** Bird colour variant, 0..6, so the device's skin picks its own player. */
  birdVariant: number;
  /** Background variant, 0..8. */
  skyVariant: number;
}

export interface FlappyScene {
  draw: (ctx: CanvasRenderingContext2D, s: SceneState, elapsed: number) => void;
  dispose: () => void;
}

const SKIES = 9;
const BIRDS = 7;

export function createFlappyScene(): FlappyScene {
  let disposed = false;
  /**
   * The vertical camera, lerped.
   *
   * The extent is taken from the Windows currently on screen rather than from the
   * whole flight: an hour of history has a range that flattens every staircase in it
   * to a straight line. Reading it per frame makes it JUMP whenever an extreme
   * scrolls off, so the target is chased rather than assigned.
   */
  let camLo: number | null = null;
  let camHi: number | null = null;
  /** Previous frame's `elapsed`, so the chase runs at wall-clock speed. */
  let lastElapsed = 0;

  // Loaded once and kept: the whole pack is a quarter of a megabyte, and swapping a
  // variant mid-run must not stall on a fetch.
  const skies: (HTMLImageElement | null)[] = [];
  for (let i = 1; i <= SKIES; i++) skies.push(loadSprite(`/flappy/background/Background${i}.png`));
  const birds: (HTMLImageElement | null)[] = [];
  for (let i = 1; i <= BIRDS; i++) birds.push(loadSprite(`/flappy/player/StyleBird1/Bird1-${i}.png`));
  const pipes = loadSprite("/flappy/tiles/PipeStyle1.png");
  const simple = loadSprite("/flappy/tiles/SimpleStyle1.png");

  /**
   * Draw one pipe as a half-plane.
   *
   * `yRef` is the mouth. `up` means the SOLID side is above the line, so the pipe
   * hangs from the ceiling with its cap at the bottom — the sheet's sprite flipped.
   * A DOWN gate is the sprite as drawn: cap on top, shaft running to the floor.
   *
   * The shaft is one stretched draw of the body's uniform band — see PIPE_BAND.
   */
  const drawPipe = (
    ctx: CanvasRenderingContext2D, img: HTMLImageElement,
    cell: number, cx: number, w: number, yRef: number, up: boolean, floor: number,
  ) => {
    const sx = (cell % PIPE_COLS) * PIPE_CELL.w;
    const sy = Math.floor(cell / PIPE_COLS) * PIPE_CELL.h;
    const scale = w / PIPE_CELL.w;
    const capH = Math.round(PIPE_CELL.cap * scale);

    // Work in a local frame whose origin IS the mouth and whose +y points into the
    // solid side. An UP gate is then the same drawing as a DOWN gate, mirrored — no
    // second code path, and no chance of the two drifting apart.
    const len = up ? yRef : floor - yRef;
    if (len <= 0) return;

    ctx.save();
    ctx.translate(Math.round(cx), Math.round(yRef));
    if (up) ctx.scale(1, -1);
    const x = -Math.round(w / 2);
    const dw = Math.round(w);

    // The shaft: one draw of the uniform band, stretched. No seam is possible.
    ctx.drawImage(img, sx, sy + PIPE_BAND.y, PIPE_CELL.w, PIPE_BAND.h,
      x, capH, dw, Math.max(Math.ceil(len - capH), 0));
    // The mouth sits last, over the body's top edge.
    ctx.drawImage(img, sx, sy, PIPE_CELL.w, PIPE_CELL.cap, x, 0, dw, capH);
    ctx.restore();
  };

  const draw = (ctx: CanvasRenderingContext2D, s: SceneState, elapsed: number) => {
    if (disposed) return;
    const W = MAIN_W;
    const H = MAIN_H;
    const dt = Math.min(Math.max(elapsed - lastElapsed, 0), 0.1);
    lastElapsed = elapsed;
    ctx.imageSmoothingEnabled = false;

    const v = s.view;
    const floor = Math.round(H * 0.82);
    // The world scrolls at frame rate off the view's own anchor, not off the 16Hz
    // slice it came with. `colW` is one Window in pixels — the unit everything the
    // camera touches is measured in.
    const span = v?.span ?? 8;
    const colW = W / span;
    const head = v ? headAt(v.startedAt, Date.now()) : 0;
    /** World column to canvas x. The bird's column always lands on `BIRD_U * W`. */
    const X = (col: number) => Math.round((col - head) * colW + BIRD_U * W);

    // ── sky ────────────────────────────────────────────────────────────────
    const sky = skies[s.skyVariant % SKIES];
    if (ready(sky)) {
      // Tiled to a whole number of copies so the seam never lands mid-frame, and
      // scrolled at a QUARTER of the world's speed: that difference is the parallax,
      // and it is the only thing that says the bird is moving rather than the pipes.
      const tile = Math.ceil(H * 0.82);
      const drift = ((head * colW * 0.25) % tile + tile) % tile;
      for (let x = -drift; x < W; x += tile) {
        ctx.drawImage(sky, Math.round(x), 0, tile, Math.ceil(H * 0.82));
      }
    } else {
      // The sky is the only thing that covers the whole frame, so its absence has to
      // be filled or the previous frame shows through the canvas.
      ctx.fillStyle = "#0d1426";
      ctx.fillRect(0, 0, W, H);
    }

    // ── ground ─────────────────────────────────────────────────────────────
    if (ready(simple)) {
      const gh = H - floor;
      const gw = Math.round(GROUND.w * (gh / GROUND.h));
      // At the world's own speed: the ground is the plane the pipes stand on, so
      // anything else makes them slide across it.
      const roll = ((head * colW) % gw + gw) % gw;
      for (let x = -roll; x < W; x += gw) {
        ctx.drawImage(simple, GROUND.x, GROUND.y, GROUND.w, GROUND.h, Math.round(x), floor, gw, gh);
      }
    }

    if (s.unsupported || !v || !v.gates.length) {
      banner(ctx, s.label);
      return;
    }

    // A scrim over the pack art. Everything this scene has to SAY — the reference
    // staircase, the round, the column a tap lands in — is drawn in thin white and
    // cyan, and none of it survived on top of a bright cartoon sky and a skyline.
    ctx.fillStyle = "rgba(6,10,26,.24)";
    ctx.fillRect(0, 0, W, H);

    // ── the vertical camera ────────────────────────────────────────────────
    let lo = Infinity;
    let hi = -Infinity;
    for (const g of v.gates) {
      if (g.ref <= 0) continue;
      if (g.ref < lo) lo = g.ref;
      if (g.ref > hi) hi = g.ref;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { banner(ctx, s.label); return; }
    const pad = Math.max((hi - lo) * 0.35, Math.max(hi, 1) * 1e-4);
    const wantLo = lo - pad;
    const wantHi = hi + pad;
    // Chased, not assigned. `dt` is derived from the frame so the chase is the same
    // speed whatever the display is doing.
    const k = Math.min(1, dt * 3);
    camLo = camLo === null ? wantLo : camLo + (wantLo - camLo) * k;
    camHi = camHi === null ? wantHi : camHi + (wantHi - camHi) * k;
    const scale = Math.max(camHi - camLo, 1e-9);
    /** A reference level to canvas y. */
    const Y = (price: number) => Math.round(floor - ((price - camLo!) / scale) * floor * 0.92 - floor * 0.04);

    /** The reference at any world position, interpolated between Windows. */
    const refAt = (p: number): number => {
      const i = Math.floor(p);
      const a = v.gates.find((g) => g.col === i);
      const b = v.gates.find((g) => g.col === i + 1);
      if (!a) return v.gates[0].ref;
      if (!b) return a.ref;
      return a.ref + (b.ref - a.ref) * (p - i);
    };

    // ── the round being flown ──────────────────────────────────────────────
    // The columns that would become a Plan, marked as a band. Continuous play makes
    // this the one thing the player cannot otherwise know: which of the Windows going
    // past are the ones being committed.
    ctx.save();
    ctx.fillStyle = "rgba(107,255,224,.07)";
    ctx.fillRect(X(v.round.from), 0, (v.round.to - v.round.from) * colW, floor);
    ctx.strokeStyle = "rgba(107,255,224,.3)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    for (const c of [v.round.from, v.round.to]) {
      ctx.beginPath();
      ctx.moveTo(X(c) + 0.5, 0);
      ctx.lineTo(X(c) + 0.5, floor);
      ctx.stroke();
    }
    ctx.restore();

    // ── the reference staircase ────────────────────────────────────────────
    // One rung per Window at its own level. This is the at-the-money reset — the
    // thing that actually defines the product — and nothing else in the app draws it.
    ctx.save();
    ctx.setLineDash([8, 7]);
    for (const g of v.gates) {
      const y = Y(g.ref) + 0.5;
      // Laid twice: a dark rule under a light one. A single white dash disappears
      // wherever it crosses a cloud, which is most of the frame.
      for (const [w, tone] of [[7, "rgba(6,10,26,.5)"], [3, "rgba(255,255,255,.8)"]] as const) {
        ctx.lineWidth = w;
        ctx.strokeStyle = tone;
        ctx.beginPath();
        ctx.moveTo(X(g.col), y);
        ctx.lineTo(X(g.col + 1), y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // ── the gates ──────────────────────────────────────────────────────────
    for (const g of v.gates) {
      const xa = X(g.col);
      const xb = X(g.col + 1);
      if (xb < -colW || xa > W + colW) continue;
      const cx = (xa + xb) / 2;
      const yRef = Y(g.ref);

      if (!g.dir) {
        // An outline only where a call can still be MADE — inside the round being
        // flown, and not yet passed. With the frame now showing ten Windows, marking
        // every uncalled one drew ten dashed boxes over ten dashed rungs and the
        // board stopped saying anything at all.
        const callable = g.col > Math.floor(head) && g.col < v.round.to;
        if (!callable) continue;
        ctx.save();
        const w = Math.round(colW * 0.62);
        const x = Math.round(cx - w / 2);
        ctx.fillStyle = "rgba(6,10,26,.16)";
        ctx.fillRect(x, 16, w, floor - 32);
        ctx.setLineDash([9, 9]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(107,255,224,.85)";
        ctx.strokeRect(x, 16, w, floor - 32);
        ctx.restore();
        continue;
      }

      // Stake sets WIDTH, never height: height is the reference level and means
      // something else entirely. A fatter pipe is a bigger bet on the same question.
      // Capped inside its own column, or a heavy Leg overlaps its neighbour and the
      // world stops reading as one gate per Window.
      const w = colW * Math.min(0.5 + g.weight * 0.9, 0.92);
      if (ready(pipes)) drawPipe(ctx, pipes, PIPE_OF[g.verdict], cx, w, yRef, g.dir === "UP", floor);

      // A pending gate breathes, so an unresolved Window reads as unresolved.
      if (g.verdict === "pending") {
        ctx.save();
        ctx.globalAlpha = 0.18 + 0.14 * Math.sin(elapsed * 3);
        ctx.fillStyle = "#fff1da";
        const top = g.dir === "UP" ? 0 : yRef;
        ctx.fillRect(Math.round(cx - w / 2), top, Math.round(w), g.dir === "UP" ? yRef : floor - yRef);
        ctx.restore();
      }
    }

    // ── the column the next call lands in ──────────────────────────────────
    // The one AHEAD of the bird — see `targetAt`. Marking the column underneath
    // would point at the one place a tap can no longer reach.
    {
      const c = Math.floor(head) + 1;
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.08 * Math.sin(elapsed * 8);
      ctx.fillStyle = "#fff1da";
      ctx.fillRect(X(c), 0, Math.ceil(colW), floor);
      ctx.restore();
    }

    // ── the flight ─────────────────────────────────────────────────────────
    const hx = Math.round(BIRD_U * W);
    const hy = Y(refAt(head));

    // The trail behind: where the price has already been, in world coordinates.
    ctx.save();
    ctx.strokeStyle = "rgba(255,212,94,.9)";
    ctx.lineWidth = 4;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath();
    let started = false;
    for (const g of v.gates) {
      if (g.col > head) break;
      const x = X(g.col);
      const y = Y(g.ref);
      started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (started = true));
    }
    if (started) { ctx.lineTo(hx, hy); ctx.stroke(); }
    ctx.restore();

    const bird = birds[s.birdVariant % BIRDS];
    if (ready(bird)) {
      // Four frames of wing. Tied to elapsed time, not to the column index, so it
      // beats steadily rather than once per Window.
      const frame = Math.floor(elapsed * 11) % BIRD_FRAMES;
      const size = Math.round(Math.min(H, W) * 0.092);
      // Bank from the slope it is climbing, sampled either side of the bird — which
      // needs no frame history and so cannot drift out of step with the position.
      const bank = Math.max(-0.6, Math.min(0.6,
        ((Y(refAt(head + 0.12)) - Y(refAt(head - 0.12))) / (0.24 * colW)) * 0.9));
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(bank);
      ctx.drawImage(bird, frame * BIRD_CELL, 0, BIRD_CELL, BIRD_CELL,
        -size / 2, -size / 2, size, size);
      ctx.restore();
    }

    banner(ctx, s.label);
  };

  return { draw, dispose: () => { disposed = true; } };
}

/** The one piece of text the scene carries. */
function banner(ctx: CanvasRenderingContext2D, label: string) {
  if (!label) return;
  ctx.save();
  ctx.font = "800 30px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  const w = ctx.measureText(label).width + 52;
  const x = MAIN_W / 2 - w / 2;
  ctx.fillStyle = "rgba(8,7,14,.72)";
  ctx.beginPath();
  ctx.roundRect(x, 20, w, 54, 27);
  ctx.fill();
  ctx.strokeStyle = "rgba(107,255,224,.8)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#6bffe0";
  ctx.fillText(label, MAIN_W / 2, 57);
  ctx.restore();
}
