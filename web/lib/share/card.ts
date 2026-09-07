/**
 * THE SHARE CARD.
 *
 * One 1200x675 image: the device you were holding, the handle that owns it, and
 * what the Plan actually did. Painted rather than screenshotted, so it is the same
 * picture on every machine and carries no browser chrome.
 *
 * Everything is drawn from sheets that are already in the page's cache by the time
 * anyone reaches the share button, but the paint still awaits them — a card is a
 * one-shot render, and unlike the live scenes there is no next frame to pick up a
 * sheet that landed late.
 */

import { asset } from "../sprites.ts";
import { fmtUsdc } from "../chain.ts";

export const CARD_W = 1200;
export const CARD_H = 675;

export interface CardData {
  handle: string;
  /** Payout minus stake across every settled Leg, in collateral base units. */
  net: bigint;
  staked: bigint;
  legs: number;
  won: number;
  lost: number;
  /** The live device canvas, drawn in as the hero. */
  device: HTMLCanvasElement | null;
}

const SHEETS = {
  sky: "/world/sky_.png",
  cloud: "/neon/Cloud1.png",
  cityFar: "/neon/city_02.png",
  cityNear: "/neon/city_01.png",
  fog: "/neon/BG_fog.png",
  tiles: "/neon/tiles_16x16.png",
  coin: "/world/objects/coin_.png",
  plat: "/flappy/tiles/TileStyle2.png",
} as const;

type Key = keyof typeof SHEETS;

/** Resolve every sheet, or give up on it. A slow CDN must not hang the dialog. */
async function load(): Promise<Partial<Record<Key, HTMLImageElement>>> {
  const out: Partial<Record<Key, HTMLImageElement>> = {};
  await Promise.all(
    (Object.keys(SHEETS) as Key[]).map(
      (k) =>
        new Promise<void>((done) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          const finish = () => done();
          img.onload = () => {
            out[k] = img;
            done();
          };
          img.onerror = finish;
          window.setTimeout(finish, 2500);
          img.src = asset(SHEETS[k]);
        }),
    ),
  );
  return out;
}

/** Canvas cannot lay out a webfont it has not decoded. Ask, but never block on it. */
async function fonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.race([
    Promise.all([
      document.fonts.load('700 44px "Silkscreen"'),
      document.fonts.load('400 22px "Pixelify Sans"'),
    ]),
    new Promise((r) => window.setTimeout(r, 1200)),
  ]).catch(() => undefined);
}

const T = 16;

/**
 * The opaque bounding box of a canvas, in its own pixels.
 *
 * Scanned on a 160px-wide copy: the crop only needs to be right to within a few
 * source pixels, and downsampling turns a two-megapixel scan into a trivial one.
 * Returns null if the canvas cannot be read — a tainted buffer must degrade to
 * drawing the whole thing, not throw inside a dialog.
 */
function contentBox(src: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  try {
    const N = 160;
    const sc = Math.min(1, N / src.width);
    const w = Math.max(1, Math.round(src.width * sc));
    const h = Math.max(1, Math.round(src.height * sc));
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const t = tmp.getContext("2d", { willReadFrequently: true });
    if (!t) return null;
    t.drawImage(src, 0, 0, w, h);
    const px = t.getImageData(0, 0, w, h).data;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Above the device's own soft shadow, which reaches well past the object
        // and would otherwise swallow most of the crop.
        if (px[(y * w + x) * 4 + 3] > 64) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0 || y1 < 0) return null;
    const pad = 2;
    const bx = Math.max(0, (x0 - pad) / sc);
    const by = Math.max(0, (y0 - pad) / sc);
    const bw = Math.min(src.width - bx, (x1 - x0 + 1 + pad * 2) / sc);
    const bh = Math.min(src.height - by, (y1 - y0 + 1 + pad * 2) / sc);
    return bw > 8 && bh > 8 ? { x: bx, y: by, w: bw, h: bh } : null;
  } catch {
    return null;
  }
}

export async function paintCard(canvas: HTMLCanvasElement, d: CardData): Promise<void> {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const g = canvas.getContext("2d");
  if (!g) return;
  const [s] = await Promise.all([load(), fonts()]);
  g.imageSmoothingEnabled = false;

  const won = d.net >= 0n;

  // ── sky ──
  g.fillStyle = won ? "#1b1038" : "#120c26";
  g.fillRect(0, 0, CARD_W, CARD_H);
  if (s.sky) {
    // A palette sheet: one 16px column stretched, never tiled.
    g.globalAlpha = 0.55;
    g.drawImage(s.sky, (won ? 2 : 3) * T, 0, T, s.sky.naturalHeight, 0, 0, CARD_W, CARD_H);
    g.globalAlpha = 1;
  }

  const band = (img: HTMLImageElement | undefined, h: number, base: number, alpha: number, off: number) => {
    if (!img) return;
    const K = Math.max(1, Math.round((CARD_H * h) / img.naturalHeight));
    const dh = img.naturalHeight * K;
    const dw = img.naturalWidth * K;
    g.globalAlpha = alpha;
    for (let x = -((off % dw) + dw) % dw - dw; x < CARD_W + dw; x += dw) {
      g.drawImage(img, Math.round(x), Math.round(CARD_H * base - dh), dw, dh);
    }
    g.globalAlpha = 1;
  };
  band(s.cloud, 0.42, 0.6, 0.75, 60);
  band(s.cityFar, 0.4, 0.9, 0.85, 140);
  band(s.cityNear, 0.44, 1.0, 1, 30);
  band(s.fog, 0.3, 1.0, 0.45, 90);

  // ── ground ──
  const px = 32;
  const gy = Math.round(CARD_H * 0.84);
  if (s.tiles) {
    for (let x = 0; x < CARD_W + px; x += px) {
      g.drawImage(s.tiles, 0, 0, T, T, x, gy, px, px);
      g.drawImage(s.tiles, 0, 2 * T, T, T, x, gy + px, px, px);
    }
  }
  g.fillStyle = "#1b1d3c";
  g.fillRect(0, gy + px * 2, CARD_W, CARD_H - gy - px * 2);

  // A slab the device stands on, wide enough to read as a plinth under it.
  if (s.plat) {
    const pw = 860;
    const ph = Math.round((pw * 80) / 176);
    g.drawImage(s.plat, 208, 112, 176, 80, Math.round(CARD_W / 2 - pw / 2), gy - Math.round(ph * 0.5), pw, ph);
  }

  // A vignette over the scene. The device and the type are the subject; without
  // this the pixel art competes with both for every pixel of the frame.
  const vig = g.createLinearGradient(0, 0, 0, CARD_H);
  vig.addColorStop(0, "rgba(6,5,14,.82)");
  vig.addColorStop(0.34, "rgba(6,5,14,.34)");
  vig.addColorStop(0.72, "rgba(6,5,14,.42)");
  vig.addColorStop(1, "rgba(6,5,14,.92)");
  g.fillStyle = vig;
  g.fillRect(0, 0, CARD_W, CARD_H);

  const pix = (size: number, weight = 400) => `${weight} ${size}px "Silkscreen", ui-monospace, monospace`;
  const ui = (size: number) => `${size}px "Pixelify Sans", ui-monospace, monospace`;
  const M = 58;

  /** Shrink to fit rather than clip: none of this text has a knowable length. */
  const fit = (text: string, room: number, start: number, weight: number) => {
    let size = start;
    g.font = pix(size, weight);
    while (size > 14 && g.measureText(text).width > room) {
      size -= 2;
      g.font = pix(size, weight);
    }
  };

  // ── the title, across the top ──
  const name = d.handle.toUpperCase();
  fit(name, CARD_W - M * 2, 62, 700);
  g.fillStyle = "#ffffff";
  g.fillText(name, M, 78);

  g.font = ui(20);
  g.fillStyle = "#f0a030";
  g.fillText("KURVV · ONE GESTURE, A SCHEDULE OF REAL POSITIONS", M, 108);

  // ── the device, as the hero ──
  //
  // Cropped to its CONTENT first. `.dev3d-gl` is a full-viewport WebGL canvas with
  // the device floating in the middle of it, so scaling the whole buffer wastes most
  // of the card on empty space — the device came out about a third the size it could
  // be. The opaque bounding box is found on a downsampled copy, which is far cheaper
  // than scanning two million pixels and plenty accurate for a crop.
  const box = d.device ? contentBox(d.device) : null;
  if (d.device && box) {
    const maxH = Math.round(CARD_H * 0.64);
    const maxW = Math.round(CARD_W * 0.92);
    const scale = Math.min(maxH / box.h, maxW / box.w);
    const dw = Math.round(box.w * scale);
    const dh = Math.round(box.h * scale);
    g.imageSmoothingEnabled = true;
    g.drawImage(
      d.device, box.x, box.y, box.w, box.h,
      Math.round(CARD_W / 2 - dw / 2), Math.round(CARD_H * 0.535 - dh / 2), dw, dh,
    );
    g.imageSmoothingEnabled = false;
  }

  // ── the stats row, along the foot ──
  const sign = d.net > 0n ? "+" : d.net < 0n ? "-" : "";
  const abs = d.net < 0n ? -d.net : d.net;
  const stats: [string, string, string][] = [
    ["NET RETURN", `${sign}$${fmtUsdc(abs, 2)}`, won ? "#56e39f" : "#ff6b81"],
    ["LEGS", String(d.legs), "#f2f0f7"],
    ["HIT", d.won + d.lost > 0 ? `${d.won} / ${d.won + d.lost}` : "—", "#f2f0f7"],
    ["STAKED", `$${fmtUsdc(d.staked, 2)}`, "#f2f0f7"],
  ];
  const labelY = CARD_H - 88;
  const valueY = CARD_H - 38;
  const col = (CARD_W - M * 2 - 260) / stats.length;
  stats.forEach(([label, value, tint], i) => {
    const x = M + col * i;
    g.font = ui(17);
    g.fillStyle = "#8d85ab";
    g.fillText(label, x, labelY);
    fit(value, col - 18, 40, 700);
    g.fillStyle = tint;
    g.fillText(value, x, valueY);
  });

  // ── the mark, bottom right ──
  g.textAlign = "right";
  g.font = pix(28, 700);
  g.fillStyle = "#ffffff";
  g.fillText("KURVV", CARD_W - M, valueY - 6);
  g.font = ui(16);
  g.fillStyle = "#8d85ab";
  g.fillText("Somnia Shannon testnet · tUSDC", CARD_W - M, valueY + 22);
  g.textAlign = "left";
}
