import type { LegView, Viewport } from "./types";

const FILL: Record<LegView["state"], string> = {
  pending: "rgba(255,255,255,0.045)",
  open:    "rgba(240,160,48,0.16)",
  won:     "rgba(34,197,94,0.22)",
  lost:    "rgba(239,68,68,0.18)",
  skipped: "rgba(255,255,255,0.03)",
};
const EDGE: Record<LegView["state"], string> = {
  pending: "rgba(255,255,255,0.10)",
  open:    "rgba(240,160,48,0.55)",
  won:     "#22c55e",
  lost:    "#ef4444",
  skipped: "rgba(255,255,255,0.10)",
};

/** One band per Window, lighting up as each Leg resolves against the drawn line. */
export function renderLegs(ctx: CanvasRenderingContext2D, vp: Viewport, legs: LegView[]) {
  ctx.save();
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  for (const leg of legs) {
    const x0 = vp.timeToX(leg.start);
    const x1 = vp.timeToX(leg.end);
    if (x1 < 0 || x0 > vp.plotW) continue;
    const w = Math.max(1, x1 - x0);

    ctx.fillStyle = FILL[leg.state];
    ctx.fillRect(x0, 0, w, vp.plotH);
    ctx.strokeStyle = EDGE[leg.state];
    ctx.lineWidth = leg.state === "pending" || leg.state === "skipped" ? 1 : 1.5;
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, vp.plotH); ctx.stroke();

    // Only label a band wide enough to hold the text, else they collide illegibly.
    if (w >= 46) {
      ctx.textAlign = "left";
      ctx.fillStyle = EDGE[leg.state];
      const arrow = leg.direction === "UP" ? "▲" : "▼";
      ctx.fillText(`${arrow}${(Number(leg.stake) / 1e6).toFixed(2)}`, x0 + 4, 5);

      // Money landing mid-Plan is the emotional core — make it unmissable.
      if (leg.paid !== undefined && leg.paid > 0n) {
        ctx.fillStyle = "#22c55e";
        ctx.fillText(`+${(Number(leg.paid) / 1e6).toFixed(3)}`, x0 + 4, 18);
      } else if (leg.state === "lost") {
        ctx.fillStyle = "rgba(239,68,68,0.8)";
        ctx.fillText("0.000", x0 + 4, 18);
      }
    }
  }
  ctx.restore();
}
