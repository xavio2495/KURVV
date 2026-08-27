import type { LegView, Viewport } from "./types";

/** A payout landing. `at` is `Date.now()` when the LegSettled log was first seen. */
export interface Flash { legIndex: number; amount: bigint; at: number }

export const FLASH_MS = 3200;
const RISE_PX = 96;

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

/**
 * The payout moment, on the canvas.
 *
 * Money arriving mid-Plan is the emotional core of the demo and a table cell throws
 * it away. This floats the amount up out of the Leg's own band and washes the band
 * in its colour, so the eye is already on the right part of the chart.
 */
export function renderFlashes(
  ctx: CanvasRenderingContext2D, vp: Viewport, legs: LegView[], flashes: Flash[], now = Date.now(),
) {
  if (!flashes.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const f of flashes) {
    const p = (now - f.at) / FLASH_MS;
    if (p < 0 || p > 1) continue;
    const leg = legs.find((l) => l.index === f.legIndex);
    if (!leg) continue;

    const x0 = vp.timeToX(leg.start);
    const x1 = vp.timeToX(leg.end);
    if (x1 < -40 || x0 > vp.plotW + 40) continue;
    const cx = (x0 + x1) / 2;

    // A fast attack so it registers, then a long decay so it can be read.
    const alpha = p < 0.1 ? p / 0.1 : Math.max(0, 1 - Math.pow((p - 0.1) / 0.9, 1.7));
    const won = f.amount > 0n;
    const rgb = won ? "34,197,94" : "239,68,68";

    // Wash the band it belongs to.
    ctx.fillStyle = `rgba(${rgb},${(0.30 * alpha).toFixed(3)})`;
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), vp.plotH);
    ctx.strokeStyle = `rgba(${rgb},${(0.9 * alpha).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, 1, Math.max(1, x1 - x0) - 2, vp.plotH - 2);

    // Float the number up out of it.
    const y = vp.plotH * 0.6 - RISE_PX * easeOut(p);
    const label = won ? `+${(Number(f.amount) / 1e6).toFixed(3)}` : "0.000";
    ctx.font = "700 30px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.shadowColor = `rgba(${rgb},${(0.85 * alpha).toFixed(3)})`;
    ctx.shadowBlur = 18;
    ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
    ctx.fillText(label, cx, y);
    ctx.shadowBlur = 0;

    ctx.font = "600 11px ui-sans-serif, -apple-system, sans-serif";
    ctx.fillStyle = `rgba(255,255,255,${(0.72 * alpha).toFixed(3)})`;
    ctx.fillText(won ? `LEG ${f.legIndex} PAID OUT` : `LEG ${f.legIndex} SETTLED`, cx, y + 24);
  }
  ctx.restore();
}

/** Drop flashes that have finished, so the array cannot grow across a long session. */
export const pruneFlashes = (flashes: Flash[], now = Date.now()) =>
  flashes.filter((f) => now - f.at <= FLASH_MS);
