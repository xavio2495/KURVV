import type { Viewport } from "./types";

export interface CursorState { x: number; y: number; inside: boolean }

export function renderCursor(ctx: CanvasRenderingContext2D, vp: Viewport, c: CursorState) {
  if (!c.inside) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(c.x, 0); ctx.lineTo(c.x, vp.plotH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, c.y); ctx.lineTo(vp.plotW, c.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  ctx.fillText(vp.yToPrice(c.y).toFixed(0), c.x + 6, c.y - 4);
  ctx.restore();
}
