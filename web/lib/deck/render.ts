/**
 * The deck renderer.
 *
 * Draws whichever scenes are on screen, pushed sideways by the deck's position. At
 * `pos = 2` slide 2 fills the frame; at `pos = 2.5` slides 2 and 3 are each half off
 * it. Nothing crossfades and nothing dims — a slide is a place, and it arrives whole.
 *
 * All motion is a function of elapsed time, so a slide looks identical every time it
 * is shown, including in the demo video.
 */

import { loadSprite, ready } from "../sprites.ts";
import { PLATS, PLAT_H, PLAT_W, PROPS, hash } from "../landing/level.ts";
import { SCENES, type Band, type Scene } from "./scenes.ts";

const COIN_FRAMES = 12;
const BIRD_FRAMES = 4;
const T = 16;

export function startDeck(canvas: HTMLCanvasElement, pos: () => number): () => void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return () => {};

  const sheets = new Map<string, HTMLImageElement | null>();
  const sheet = (src: string) => {
    if (!sheets.has(src)) sheets.set(src, loadSprite(src));
    return sheets.get(src) ?? null;
  };
  for (const s of SCENES) {
    for (const b of s.bands) sheet(b.src);
    if (s.ground) sheet(s.ground.src);
    for (const f of s.fliers) sheet(f.src);
  }
  for (const p of Object.values(PLATS)) sheet(p.src);
  const objects = sheet("/world/objects/staticObjects_.png");
  const coin = sheet("/world/objects/coin_.png");

  let W = 0;
  let H = 0;
  let frame = 0;
  const t0 = performance.now();

  const size = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  };

  const band = (b: Band, ox: number, elapsed: number) => {
    const img = sheet(b.src);
    if (!ready(img)) return;
    const bottom = H * b.base;
    ctx.globalAlpha = b.alpha ?? 1;

    // A palette sheet has no horizontal detail to lose, so one column is stretched
    // across the frame rather than tiled — tiling it paints rainbow bars.
    if (b.strip) {
      const K = Math.max(1, Math.round((H * b.h) / img.naturalHeight));
      const dh = img.naturalHeight * K;
      ctx.drawImage(img, b.strip.col * b.strip.px, 0, b.strip.px, img.naturalHeight,
        ox, Math.round(bottom - dh), W, dh);
      ctx.globalAlpha = 1;
      return;
    }

    const K = Math.max(1, Math.round((H * b.h) / img.naturalHeight));
    const dh = img.naturalHeight * K;
    const dw = img.naturalWidth * K;
    const shift = (((elapsed * b.drift * W) % dw) + dw) % dw;
    for (let x = -shift - dw; x < W + dw; x += dw) {
      if (b.tileY) {
        for (let y = bottom - dh; y > -dh; y -= dh) ctx.drawImage(img, Math.round(ox + x), Math.round(y), dw, dh);
      } else {
        ctx.drawImage(img, Math.round(ox + x), Math.round(bottom - dh), dw, dh);
      }
    }
    ctx.globalAlpha = 1;
  };

  const ground = (s: Scene, ox: number) => {
    if (!s.ground) return;
    const img = sheet(s.ground.src);
    if (!ready(img)) return;
    const K = Math.max(2, Math.round(H / 30 / T));
    const px = T * K;
    const y = Math.round(H * s.ground.y);
    for (let x = -px; x < W + px; x += px) {
      const gx = Math.round(ox + x);
      ctx.drawImage(img, s.ground.top[0], s.ground.top[1], T, T, gx, y, px, px);
      for (let n = 1; n <= 2; n++) {
        ctx.drawImage(img, s.ground.fill[0], s.ground.fill[1], T, T, gx, y + n * px, px, px);
      }
    }
    ctx.fillStyle = s.ground.deep;
    ctx.fillRect(ox - px, y + 3 * px, W + px * 2, H - (y + 3 * px));
  };

  const slabs = (s: Scene, ox: number) => {
    for (const sl of s.slabs) {
      const spec = PLATS[sl.k];
      const img = sheet(spec.src);
      if (!ready(img)) continue;
      const w = Math.round(sl.s * W);
      const h = Math.round((w * PLAT_H) / PLAT_W);
      const x = Math.round(ox + sl.x * W - w / 2);
      const y = Math.round(sl.y * H);
      ctx.save();
      if (sl.f) {
        ctx.translate(x + w, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, spec.sx, spec.sy, PLAT_W, PLAT_H, 0, 0, w, h);
      } else {
        ctx.drawImage(img, spec.sx, spec.sy, PLAT_W, PLAT_H, x, y, w, h);
      }
      ctx.restore();
    }
  };

  const items = (s: Scene, ox: number) => {
    if (!ready(objects)) return;
    for (const it of s.items) {
      const [sx, sy, sw, sh] = PROPS[it.k];
      const h = Math.round(it.h * H);
      const w = Math.round((h * sw) / sh);
      const x = Math.round(ox + it.x * W - w / 2);
      const y = Math.round(it.y * H - h);
      ctx.save();
      if (it.f) {
        ctx.translate(x + w, y);
        ctx.scale(-1, 1);
        ctx.drawImage(objects, sx, sy, sw, sh, 0, 0, w, h);
      } else {
        ctx.drawImage(objects, sx, sy, sw, sh, x, y, w, h);
      }
      ctx.restore();
    }
  };

  const arcs = (s: Scene, ox: number, elapsed: number) => {
    if (!ready(coin)) return;
    const c = Math.round(H * 0.034);
    s.arcs.forEach((a, ai) => {
      for (let i = 0; i <= a.n; i++) {
        const t = i / a.n;
        const x = Math.round(ox + (a.x0 + (a.x1 - a.x0) * t) * W - c / 2);
        // A catenary: coins on a rope sag rather than running straight.
        const y = Math.round((a.y0 + (a.y1 - a.y0) * t + Math.sin(t * Math.PI) * a.sag) * H);
        const f = Math.floor(elapsed * 9 + ai * 3 + i) % COIN_FRAMES;
        ctx.drawImage(coin, f * T, 0, T, T, x, y, c, c);
      }
    });
  };

  const fliers = (s: Scene, ox: number, elapsed: number) => {
    s.fliers.forEach((f, i) => {
      const img = sheet(f.src);
      if (!ready(img)) return;
      const sz = Math.round(f.s * W);
      // Wraps across the frame, so a slide left open keeps moving.
      const span = W + sz * 2;
      const x = Math.round(ox + (((f.x * W + elapsed * f.drift * W) % span) + span) % span - sz);
      const y = Math.round(f.y * H + Math.sin(elapsed * 1.4 + i * 1.7) * H * f.bob);
      const fr = Math.floor(elapsed * f.rate + i) % BIRD_FRAMES;
      ctx.drawImage(img, fr * T, 0, T, T, x, y, sz, sz);
    });
  };

  /**
   * Weather. Deterministic: every particle's path is a closed form of its index and
   * the clock, so there is no simulation state to diverge between two runs.
   */
  const weather = (s: Scene, ox: number, elapsed: number) => {
    if (s.weather === "none" || s.wn <= 0) return;
    ctx.save();
    ctx.fillStyle = s.wtint;
    for (let i = 0; i < s.wn; i++) {
      const seed = hash(i * 1.7);
      const seed2 = hash(i * 4.3 + 9);
      let x = seed * W;
      let y = 0;
      let a = 0.5;
      let sz = Math.max(2, Math.round(H * 0.004));

      if (s.weather === "snow") {
        const fall = ((elapsed * (0.05 + seed2 * 0.06) + seed) % 1) * H;
        y = fall;
        x = (seed * W + Math.sin(elapsed * 0.6 + i) * W * 0.02) % W;
        a = 0.5 + seed2 * 0.45;
        sz = Math.max(2, Math.round(H * (0.003 + seed2 * 0.004)));
      } else if (s.weather === "rain") {
        const fall = ((elapsed * (0.5 + seed2 * 0.3) + seed) % 1) * H;
        y = fall;
        x = (seed * W - fall * 0.12) % W;
        a = 0.28 + seed2 * 0.3;
        ctx.globalAlpha = a;
        ctx.fillRect(Math.round(ox + x), Math.round(y), 1, Math.round(H * 0.022));
        continue;
      } else if (s.weather === "ember" || s.weather === "spark") {
        const rise = 1 - ((elapsed * (0.06 + seed2 * 0.08) + seed) % 1);
        y = rise * H;
        x = (seed * W + Math.sin(elapsed * 1.1 + i * 2.3) * W * 0.03) % W;
        a = (1 - rise) * 0.9;
        sz = Math.max(2, Math.round(H * 0.0035));
      } else if (s.weather === "leaf") {
        const fall = ((elapsed * (0.07 + seed2 * 0.05) + seed) % 1) * H;
        y = fall;
        x = (seed * W + Math.sin(elapsed * 0.9 + i) * W * 0.05) % W;
        a = 0.45 + seed2 * 0.4;
        sz = Math.max(3, Math.round(H * 0.005));
      }
      ctx.globalAlpha = a;
      ctx.fillRect(Math.round(ox + x), Math.round(y), sz, sz);
    }
    ctx.restore();
  };

  const scene = (i: number, ox: number, elapsed: number) => {
    const s = SCENES[i];
    if (!s) return;
    ctx.fillStyle = s.wash;
    ctx.fillRect(ox, 0, W + 1, H);
    for (const b of s.bands) band(b, ox, elapsed);
    ground(s, ox);
    slabs(s, ox);
    items(s, ox);
    arcs(s, ox, elapsed);
    weather(s, ox, elapsed);
    fliers(s, ox, elapsed);
  };

  const render = () => {
    if (W === 0) return;
    const p = pos();
    const elapsed = (performance.now() - t0) / 1000;
    ctx.fillStyle = "#07060e";
    ctx.fillRect(0, 0, W, H);
    // Only the one or two slides actually on screen.
    const first = Math.max(0, Math.floor(p));
    const last = Math.min(SCENES.length - 1, Math.ceil(p));
    for (let i = first; i <= last; i++) scene(i, Math.round((i - p) * W), elapsed);
  };

  const loop = () => {
    if (!document.hidden) render();
    frame = requestAnimationFrame(loop);
  };
  const onResize = () => {
    size();
    render();
  };

  size();
  render();
  frame = requestAnimationFrame(loop);
  window.addEventListener("resize", onResize);
  for (const img of sheets.values()) img?.addEventListener("load", render);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", onResize);
    for (const img of sheets.values()) img?.removeEventListener("load", render);
  };
}
