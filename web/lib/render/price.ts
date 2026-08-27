import { AXIS_W, type Dims, type PricePoint, type Viewport } from "./types";

const GRID = "rgba(255,255,255,0.05)";
const LINE = "#e8eaed";

/** Grid, price axis, and the on-chain settlement reference line. */
export function renderPrice(
  ctx: CanvasRenderingContext2D, dims: Dims, vp: Viewport, price: PricePoint[],
) {
  ctx.save();
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const y = (vp.plotH * i) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vp.plotW, y); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.fillText(vp.yToPrice(y).toFixed(0), dims.w - 6, y);
  }

  // The boundary between what happened and what the user is predicting.
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath(); ctx.moveTo(vp.nowX, 0); ctx.lineTo(vp.nowX, vp.plotH); ctx.stroke();
  ctx.setLineDash([]);

  const pts = price.filter((p) => p.t >= vp.t0);
  if (pts.length > 1) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = vp.timeToX(p.t), y = vp.priceToY(p.price);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.5; ctx.lineJoin = "round";
    ctx.stroke();

    const last = pts[pts.length - 1];
    const lx = vp.timeToX(last.t), ly = vp.priceToY(last.price);
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = LINE; ctx.fill();
    ctx.fillStyle = "rgba(232,234,237,0.9)";
    ctx.textAlign = "left";
    ctx.fillText(last.price.toFixed(0), Math.min(lx + 7, vp.plotW - AXIS_W), ly);
  }
  ctx.restore();
}
