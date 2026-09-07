/**
 * THE WORLD — a side-scrolling platformer six viewports wide.
 *
 * Scroll depth becomes horizontal travel. What gets drawn is `lib/landing/level.ts`:
 * a hand-composed set of floating masses at many heights, props stacked on them and
 * coins strung between them. There is deliberately NO ground line and no per-section
 * band — materials interleave the whole way across, so there is nowhere the theme
 * visibly switches.
 *
 * THE COPY AND THE SCREENS ARE PART OF THE LEVEL. The renderer is handed the live
 * DOM rectangles of every text block and mode display, and builds terrain around
 * them: a dark rock face behind the prose with a lit ledge over it and a floor under
 * it, and a slab bezel under each screen so it sits in the structure rather than
 * floating on it. Taking the rects from the DOM rather than recomputing the layout
 * means the frame cannot drift out of register with the thing it frames.
 */

import { loadSprite, ready } from "../sprites.ts";
import type { Evo } from "./evolution.ts";
import { ramp } from "./evolution.ts";
import { ZONES, ZONES_N, zoneWeight, type Zone } from "./zones.ts";
import {
  ARCS, HERO_PROPS, PLATFORMS, PLAT_H, PLAT_W, PLATS, PROPS, SCATTER, hash,
  type Plat, type Prop,
} from "./level.ts";

/**
 * Where the mountain summit sits, as a fraction of viewport height.
 * `globals.css` stands the device on the same number — see `--lp-ground`.
 */
export const GROUND_FRAC = 0.53;

const COIN_FRAMES = 12;
const BIRD_FRAMES = 4;

/** Parallax and haze per depth band. See `Plat.z`. */
const DEPTH = [
  { par: 0.45, haze: 0.62, dim: 0.42 },
  { par: 1, haze: 0, dim: 0 },
  { par: 1.28, haze: 0, dim: 0.18 },
];

/** Three travellers, at three depths and three speeds. */
const CHARACTERS = [
  { src: "/flappy/player/StyleBird1/Bird1-3.png", x: 0.3, y: 0.15, s: 2.6, par: 1.1, bob: 0.05, rate: 10 },
  { src: "/flappy/player/StyleBird2/Bird2-5.png", x: 0.62, y: 0.24, s: 1.8, par: 0.72, bob: 0.035, rate: 8 },
  { src: "/flappy/player/StyleBird2/Bird2-2.png", x: 0.84, y: 0.1, s: 1.3, par: 0.5, bob: 0.028, rate: 13 },
];

/**
 * How far a page travels through the world, and where it starts.
 *
 * `panels` is how many full viewports the page's track is, so the world moves in
 * lockstep with the copy — a platform at parallax 1 and the panel it sits behind
 * advance by the same amount. `offset` is where in the six-viewport level that page
 * begins, so `/pitch` and `/board` are different PLACES rather than the same opening
 * stretch shown again.
 */
export interface WorldOpts {
  panels: number;
  offset?: number;
}

export function startWorld(
  canvas: HTMLCanvasElement,
  evo: Evo,
  rects: () => { copy: DOMRect[]; screens: DOMRect[] },
  opts: WorldOpts = { panels: ZONES_N },
): () => void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return () => {};

  const sheets = new Map<string, HTMLImageElement | null>();
  const sheet = (src: string) => {
    if (!sheets.has(src)) sheets.set(src, loadSprite(src));
    return sheets.get(src) ?? null;
  };
  for (const z of ZONES) for (const l of z.layers) sheet(l.src);
  for (const p of Object.values(PLATS)) sheet(p.src);
  for (const c of CHARACTERS) sheet(c.src);
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

  /** The wash the zones blend through, so a missing sheet is never a black hole. */
  const backdrop = (at: number, p: number) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < ZONES_N; i++) {
      const w = zoneWeight(at, i);
      if (w <= 0) continue;
      r += ZONES[i].base[0] * w;
      g += ZONES[i].base[1] * w;
      b += ZONES[i].base[2] * w;
    }
    const lit = 0.1 + 0.9 * ramp(p, 0, 0.16);
    ctx.fillStyle = `rgb(${Math.round(r * lit)},${Math.round(g * lit)},${Math.round(b * lit)})`;
    ctx.fillRect(0, 0, W, H);
    return `rgb(${Math.round(r * lit)},${Math.round(g * lit)},${Math.round(b * lit)})`;
  };

  const skyLayers = (z: Zone, i: number, a: number, worldX: number) => {
    for (const l of z.layers) {
      const img = sheet(l.src);
      if (!ready(img)) continue;
      const K = Math.max(1, Math.round((H * l.h) / img.naturalHeight));
      const dh = img.naturalHeight * K;
      const dw = img.naturalWidth * K;
      const off = (worldX - i * W) * l.par;
      const shift = ((off % dw) + dw) % dw;
      const bottom = H * l.base;
      ctx.globalAlpha = a * (l.alpha ?? 1);
      for (let x = -shift - dw; x < W + dw; x += dw) {
        if (l.tileY) {
          for (let y = bottom - dh; y > -dh; y -= dh) ctx.drawImage(img, Math.round(x), Math.round(y), dw, dh);
        } else {
          ctx.drawImage(img, Math.round(x), Math.round(bottom - dh), dw, dh);
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  /** Screen x for a world x, at a given depth. */
  const sx = (x: number, worldX: number, par: number) => x * W - worldX * par;

  /**
   * How much to shrink the level on a narrow viewport.
   *
   * Every placement is a fraction of viewport WIDTH, which keeps the composition
   * right on a desktop and wrong on a phone: a slab at 0.34 of a 1700px frame reads
   * as one platform among many, and the same slab on a 360px frame is a third of the
   * screen. The whole level steps down together so the arrangement survives.
   */
  const gauge = () => (W < 620 ? 0.6 : W < 900 ? 0.78 : 1);

  const platform = (p: Plat, worldX: number, haze: string) => {
    const spec = PLATS[p.k];
    const img = sheet(spec.src);
    if (!ready(img)) return;
    const d = DEPTH[p.z];
    const w = Math.round(p.s * W * gauge());
    const h = Math.round((w * PLAT_H) / PLAT_W);
    const x = Math.round(sx(p.x, worldX, d.par) - w / 2);
    const y = Math.round(p.y * H);
    if (x > W + w || x + w < -w) return;

    ctx.save();
    if (p.f) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, spec.sx, spec.sy, PLAT_W, PLAT_H, 0, 0, w, h);
    } else {
      ctx.drawImage(img, spec.sx, spec.sy, PLAT_W, PLAT_H, x, y, w, h);
    }
    ctx.restore();

    // Push the far band into the sky's own colour rather than greying it, so depth
    // reads as air between you and it instead of as a faded sprite.
    if (d.dim > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = d.dim;
      ctx.fillStyle = haze;
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      ctx.restore();
    }
  };

  const prop = (p: Prop, worldX: number) => {
    if (!ready(objects)) return;
    const [ox, oy, ow, oh] = PROPS[p.k];
    const d = DEPTH[p.z];
    const h = Math.round(p.h * H * gauge());
    const w = Math.round((h * ow) / oh);
    const x = Math.round(sx(p.x, worldX, d.par) - w / 2);
    const y = Math.round(p.y * H - h);
    if (x > W + w || x + w < -w) return;
    ctx.save();
    if (p.f) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(objects, ox, oy, ow, oh, 0, 0, w, h);
    } else {
      ctx.drawImage(objects, ox, oy, ow, oh, x, y, w, h);
    }
    ctx.restore();
  };

  /** Props scattered along each platform's top, chosen deterministically. */
  const scatter = (worldX: number, band: 0 | 1 | 2) => {
    for (let i = 0; i < PLATFORMS.length; i++) {
      const p = PLATFORMS[i];
      if (p.z !== band || p.z === 0) continue;
      const set = SCATTER[Math.min(SCATTER.length - 1, Math.max(0, Math.floor(p.x)))];
      const n = 1 + Math.floor(hash(i * 3.3) * 3);
      for (let j = 0; j < n; j++) {
        const r = hash(i * 7.7 + j * 2.1);
        const k = set[Math.floor(hash(i * 5.5 + j) * set.length)];
        prop({
          x: p.x + (r - 0.5) * p.s * 0.78,
          y: p.y + 0.004,
          h: 0.05 + hash(i + j * 9.1) * 0.06,
          k,
          z: p.z,
          f: hash(i * 11.3 + j) > 0.5,
        }, worldX);
      }
    }
  };

  const arcs = (worldX: number, elapsed: number) => {
    if (!ready(coin)) return;
    const s = Math.round(H * 0.032);
    ARCS.forEach((a, ai) => {
      for (let i = 0; i <= a.n; i++) {
        const t = i / a.n;
        const x = Math.round(sx(a.x0 + (a.x1 - a.x0) * t, worldX, 1) - s / 2);
        // A catenary, not a straight line: coins hung on a rope sag.
        const y = Math.round((a.y0 + (a.y1 - a.y0) * t + Math.sin(t * Math.PI) * a.sag) * H);
        if (x > W + s || x + s < -s) continue;
        const f = Math.floor(elapsed * 9 + ai * 3 + i) % COIN_FRAMES;
        ctx.drawImage(coin, f * 16, 0, 16, 16, x, y, s, s);
      }
    });
  };

  /**
   * Support legs under a plate — a billboard's posts, or the mounting under a block
   * of copy.
   *
   * The plate itself is DOM: one element with its own border, so the frame and what
   * it frames are physically the same box and cannot drift apart. The canvas only
   * draws what holds it up, which is the part that has to line up with the level
   * rather than with the text.
   */
  const legs = (r: DOMRect, i: number) => {
    if (!ready(objects)) return;
    const [ox, oy, ow, oh] = PROPS.pole;
    const drop = Math.round(H * (0.1 + (i % 3) * 0.02));
    const lh = drop;
    const lw = Math.max(6, Math.round((lh * ow) / oh));
    const y = Math.round(r.bottom) - 2;
    if (r.left > W || r.right < 0) return;
    for (const x of [Math.round(r.left + r.width * 0.2), Math.round(r.left + r.width * 0.8 - lw)]) {
      ctx.drawImage(objects, ox, oy, ow, oh, x, y, lw, lh);
    }
    // A footing slab where the legs land, so they stand on something.
    const spec = PLATS[(["grey", "slate", "clay", "ash"] as const)[i % 4]];
    const img = sheet(spec.src);
    if (!ready(img)) return;
    const pw = Math.round(r.width * 0.5);
    const ph = Math.round((pw * PLAT_H) / PLAT_W);
    ctx.drawImage(img, spec.sx, spec.sy, PLAT_W, PLAT_H,
      Math.round(r.left + r.width / 2 - pw / 2), y + lh - Math.round(ph * 0.38), pw, ph);
  };

  const characters = (worldX: number, elapsed: number) => {
    for (let i = 0; i < CHARACTERS.length; i++) {
      const c = CHARACTERS[i];
      const img = sheet(c.src);
      if (!ready(img)) continue;
      const s = Math.round(H * 0.028 * c.s);
      // Each one drifts on its own parallax, so they separate as you travel.
      const x = Math.round(((c.x * W - worldX * (c.par - 1) * 0.06) % (W + s * 4) + W + s * 4) % (W + s * 4) - s * 2);
      const y = Math.round(
        c.y * H + Math.sin(worldX * 0.004 + i * 2.1) * H * c.bob + Math.sin(elapsed * 2.2 + i) * s * 0.16,
      );
      const f = Math.floor(elapsed * c.rate + i * 2) % BIRD_FRAMES;
      ctx.drawImage(img, f * 16, 0, 16, 16, x, y, s, s);
    }
  };

  const render = () => {
    if (W === 0) return;
    const p = evo.p;
    const travel = Math.max(0, opts.panels - 1);
    const worldX = (opts.offset ?? 0) * W + p * travel * W;
    const at = worldX / Math.max(1, W);
    const elapsed = (performance.now() - t0) / 1000;

    const haze = backdrop(at, p);
    const dawn = (opts.offset ?? 0) > 0 ? 1 : ramp(p, 0.015, 0.13);
    if (dawn <= 0.002) return;

    ctx.save();
    ctx.globalAlpha = dawn;

    for (let i = 0; i < ZONES_N; i++) {
      const a = zoneWeight(at, i);
      if (a > 0.004) skyLayers(ZONES[i], i, a * dawn, worldX);
    }
    ctx.globalAlpha = dawn;

    for (const pl of PLATFORMS) if (pl.z === 0) platform(pl, worldX, haze);
    for (const pl of PLATFORMS) if (pl.z === 1) platform(pl, worldX, haze);
    scatter(worldX, 1);
    for (const h of HERO_PROPS) if (h.z === 1) prop(h, worldX);
    arcs(worldX, elapsed);

    const r = rects();
    r.screens.forEach(legs);
    r.copy.forEach(legs);

    for (const pl of PLATFORMS) if (pl.z === 2) platform(pl, worldX, haze);
    scatter(worldX, 2);
    for (const h of HERO_PROPS) if (h.z === 2) prop(h, worldX);


    characters(worldX, elapsed);
    ctx.restore();
  };

  const loop = () => {
    if (!document.hidden) render();
    frame = requestAnimationFrame(loop);
  };
  // rAF alone is not enough: a hidden, occluded or throttled tab skips the rendering
  // step entirely, and the world would simply never build. Scroll is the backstop.
  const onScroll = () => render();
  const onResize = () => {
    size();
    render();
  };

  size();
  render();
  frame = requestAnimationFrame(loop);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  for (const img of sheets.values()) img?.addEventListener("load", render);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    for (const img of sheets.values()) img?.removeEventListener("load", render);
  };
}
