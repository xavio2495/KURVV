import type { Viewport } from "./types";

export interface DrawnPoint { x: number; y: number }

/** The user's stroke, in raw canvas pixels. */
export function renderCurve(ctx: CanvasRenderingContext2D, vp: Viewport, pts: DrawnPoint[], live: boolean) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = live ? "#f0a030" : "rgba(240,160,48,0.85)";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(240,160,48,0.5)";
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.restore();
  void vp;
}
