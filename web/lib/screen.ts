import type { Skin } from "./skins";

/**
 * The main screen's contents, drawn 2D.
 *
 * The device's big display carries the chart. In the product that is the WebGL
 * stage; here it is a flat render of the same data, which is what the standalone
 * hardware view needs and what a deck slide can show without a live chain.
 */
export const MAIN_W = 900;
export const MAIN_H = 780;

export interface MainState {
  points: { t: number; price: number }[];
  /** Normalised drawn Curve, `u` across the future span, `v` bottom-to-top. */
  curve: { u: number; v: number }[] | null;
  legCount: number;
  elapsed: number;
}

/** A stand-in series, so the showcase reads as a live instrument with no chain. */
export function demoSeries(elapsed: number): { t: number; price: number }[] {
  const out: { t: number; price: number }[] = [];
  for (let i = 0; i < 220; i++) {
    const t = i;
    const drift = Math.sin(i * 0.055 + elapsed * 0.18) * 620;
    const swell = Math.sin(i * 0.017 - elapsed * 0.05) * 1450;
    const chop = Math.sin(i * 0.41 + elapsed * 0.9) * 130;
    out.push({ t, price: 79000 + drift + swell + chop });
  }
  return out;
}

export function drawMain(g: CanvasRenderingContext2D, s: MainState, skin: Skin) {
  const W = MAIN_W;
  const H = MAIN_H;
  g.fillStyle = skin.ground;
  g.fillRect(0, 0, W, H);

  const pts = s.points;
  if (pts.length < 2) return;

  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) { if (p.price < lo) lo = p.price; if (p.price > hi) hi = p.price; }
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, 1) * 1.7;
  lo = mid - half;
  hi = mid + half;

  const futureFrac = 0.32;
  const plotW = W - 40;
  const nowX = 20 + plotW * (1 - futureFrac);
  const xOf = (i: number) => 20 + (i / (pts.length - 1)) * (nowX - 20);
  const yOf = (p: number) => H - 34 - ((p - lo) / (hi - lo)) * (H - 74);

  // Window grid: the Legs land on these boundaries.
  g.strokeStyle = "rgba(255,255,255,.06)";
  g.lineWidth = 1;
  for (let i = 0; i <= s.legCount; i++) {
    const x = nowX + (i / s.legCount) * (W - 20 - nowX);
    g.beginPath();
    g.moveTo(x, 22);
    g.lineTo(x, H - 34);
    g.stroke();
  }

  // Four lanes at falling resolutions, in the skin's palette — the same idea as the
  // 3D stage, flattened: the near lane jagged, the far ones smooth.
  const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
  [8, 4, 2, 1].forEach((step, li) => {
    g.strokeStyle = hex(skin.lanes[3 - li]);
    g.lineWidth = li === 3 ? 2.4 : 1.4;
    g.globalAlpha = li === 3 ? 1 : 0.5;
    g.beginPath();
    let first = true;
    for (let i = 0; i < pts.length; i += step) {
      const x = xOf(i);
      const y = yOf(pts[i].price);
      first ? (g.moveTo(x, y), (first = false)) : g.lineTo(x, y);
    }
    g.stroke();
  });
  g.globalAlpha = 1;

  // `now`.
  g.strokeStyle = "rgba(240,160,48,.55)";
  g.setLineDash([5, 6]);
  g.beginPath();
  g.moveTo(nowX, 22);
  g.lineTo(nowX, H - 34);
  g.stroke();
  g.setLineDash([]);

  // The drawn Curve, in the future span.
  if (s.curve && s.curve.length > 1) {
    g.strokeStyle = "#6bffe0";
    g.lineWidth = 3;
    g.lineJoin = g.lineCap = "round";
    g.shadowColor = "rgba(107,255,224,.8)";
    g.shadowBlur = 16;
    g.beginPath();
    s.curve.forEach((p, i) => {
      const x = nowX + p.u * (W - 20 - nowX);
      const y = 22 + (1 - p.v) * (H - 56);
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    });
    g.stroke();
    g.shadowBlur = 0;
  }

  const last = pts[pts.length - 1];
  g.fillStyle = "#e8eaed";
  g.font = "600 26px ui-monospace, Menlo, monospace";
  g.fillText(`$${Math.round(last.price).toLocaleString()}`, 22, 40);
  g.fillStyle = "#6b6486";
  g.font = "500 17px ui-sans-serif, system-ui, sans-serif";
  g.fillText("BTC · draw the future span", 22, H - 12);
}

/**
 * The control panel at MAIN resolution, for when the two displays are swapped.
 *
 * Same rows, same cursor, same edit state as the small panel — but drawn in the
 * device's own palette rather than the DMG's four tones, because this is the chart
 * screen and it is not pretending to be a Game Boy.
 */
/** The wordmark, loaded once and drawn onto the panel. */
let markImg: HTMLImageElement | null = null;
let markReady = false;
function mark(): HTMLImageElement | null {
  if (!markImg && typeof document !== "undefined") {
    markImg = new Image();
    markImg.onload = () => { markReady = true; };
    markImg.src = "/kurvv.svg";
  }
  return markReady ? markImg : null;
}

/** Row glyphs, drawn inline — a settings list with no icons reads as a form. */
const ROW_ICON: Record<string, (g: CanvasRenderingContext2D, x: number, y: number, c: string) => void> = {
  wallet: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.roundRect(x - 13, y - 9, 26, 18, 4); g.stroke(); g.beginPath(); g.moveTo(x - 13, y - 3); g.lineTo(x + 8, y - 3); g.stroke(); },
  stake: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; for (const dy of [6, 0, -6]) { g.beginPath(); g.ellipse(x, y + dy, 11, 4.5, 0, 0, Math.PI * 2); g.stroke(); } },
  legs: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 13, y + 8); g.lineTo(x - 4, y + 8); g.lineTo(x - 4, y - 2); g.lineTo(x + 5, y - 2); g.lineTo(x + 5, y - 9); g.lineTo(x + 13, y - 9); g.stroke(); },
  window: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x, y); g.lineTo(x + 5, y + 3); g.stroke(); },
  token: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(x, y - 13); g.lineTo(x, y + 13); g.stroke(); },
  skin: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.roundRect(x - 12, y - 12, 24, 24, 5); g.stroke(); g.fillStyle = c; g.fillRect(x - 12, y, 24, 12); },
};

/** Where each row sits, so a tap on the glass can be turned back into a row index. */
export const PANEL_ROWS = { top: 210, height: 84 };
export function rowAtUV(v: number, count: number): number {
  // `v` is bottom-up; the list is drawn top-down.
  const y = (1 - v) * MAIN_H;
  const i = Math.floor((y - PANEL_ROWS.top + PANEL_ROWS.height / 2) / PANEL_ROWS.height);
  return i >= 0 && i < count ? i : -1;
}

/**
 * The settings surface when it takes the main display.
 *
 * A CONSOLE menu, not a camera menu: a titled bar, chunky rows with glyphs, a solid
 * accent block on the selection with chevrons either side, and a button-hint footer.
 * The previous version was a thin list of label/value pairs, which is the visual
 * language of a settings form rather than a machine you play.
 */
export function drawControlLarge(
  g: CanvasRenderingContext2D,
  rows: { id: string; label: string; value: string; editable: boolean }[],
  cursor: number,
  editing: boolean,
  connected: boolean,
  skin: Skin,
  elapsed = 0,
) {
  const W = MAIN_W;
  const H = MAIN_H;
  const accent = `#${skin.lanes[0].toString(16).padStart(6, "0")}`;

  g.fillStyle = "#08070e";
  g.fillRect(0, 0, W, H);

  // ── title bar ──
  g.fillStyle = accent;
  g.fillRect(0, 0, W, 84);
  const m = mark();
  if (m) {
    const w = 168;
    g.globalCompositeOperation = "destination-out";
    g.drawImage(m, 30, 26, w, (w / m.width) * m.height);
    g.globalCompositeOperation = "source-over";
  } else {
    g.fillStyle = "#08070e";
    g.font = "800 italic 40px ui-sans-serif, system-ui, sans-serif";
    g.fillText("KURVV", 30, 58);
  }
  g.fillStyle = "rgba(0,0,0,.72)";
  g.font = "800 22px ui-monospace, Menlo, monospace";
  g.textAlign = "right";
  g.fillText(connected ? "LINKED" : "NO LINK", W - 30, 52);
  g.textAlign = "left";

  // ── rows ──
  rows.forEach((r, i) => {
    const y = PANEL_ROWS.top + i * PANEL_ROWS.height;
    const on = i === cursor;
    if (on) {
      // A solid block, not a tint: the selection has to be unmistakable across a room.
      g.fillStyle = editing ? accent : "rgba(255,255,255,.13)";
      g.fillRect(24, y - 34, W - 48, PANEL_ROWS.height - 14);
      if (editing) {
        g.fillStyle = "rgba(0,0,0,.16)";
        g.fillRect(24, y - 34, W - 48, PANEL_ROWS.height - 14);
      }
      // Chevrons: this row is the one the controls act on.
      const nudge = Math.sin(elapsed * 5) * 3;
      g.fillStyle = editing ? "#08070e" : accent;
      g.font = "800 30px ui-sans-serif, system-ui, sans-serif";
      g.fillText("▸", 34 - nudge, y + 6);
      g.textAlign = "right";
      g.fillText("◂", W - 34 + nudge, y + 6);
      g.textAlign = "left";
    }

    const ink = on && editing ? "#08070e" : on ? "#ffffff" : "#6f6a8c";
    ROW_ICON[r.id]?.(g, 88, y - 4, ink);

    g.fillStyle = ink;
    g.font = "800 30px ui-sans-serif, system-ui, sans-serif";
    g.fillText(r.label, 122, y + 7);

    g.textAlign = "right";
    g.fillStyle = on && editing ? "#08070e" : on ? accent : "#b8b3cc";
    g.font = "800 32px ui-monospace, Menlo, monospace";
    g.fillText(r.value, W - 66, y + 7);
    g.textAlign = "left";
  });

  // ── button hints ──
  const fy = H - 46;
  g.fillStyle = "rgba(255,255,255,.045)";
  g.fillRect(0, H - 92, W, 92);
  const hints: [string, string][] = editing
    ? [["◉", "CONFIRM"], ["↕", "CHANGE"], ["↺", "BACK"]]
    : [["◉", "SELECT"], ["↕", "MOVE"], ["✎", "DRAW"]];
  let x = 34;
  for (const [k, label] of hints) {
    g.fillStyle = accent;
    g.font = "800 24px ui-sans-serif, system-ui, sans-serif";
    g.fillText(k, x, fy);
    x += 34;
    g.fillStyle = "#7b7595";
    g.font = "700 19px ui-sans-serif, system-ui, sans-serif";
    g.fillText(label, x, fy);
    x += g.measureText(label).width + 44;
  }

  // Scanlines. Cheap, and it puts the panel behind glass.
  g.fillStyle = "rgba(0,0,0,.16)";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
}

/**
 * Standings, on the device's own screen.
 *
 * It is a console view, not a web page — the trophy key is a channel on the machine,
 * so the leaderboard lives where the machine can show it.
 */
export function drawBoard(
  g: CanvasRenderingContext2D,
  rows: { rank: number; who: string; plans: number; hit: string; ret: string }[],
  skin: Skin,
) {
  const W = MAIN_W;
  const H = MAIN_H;
  const accent = `#${skin.lanes[0].toString(16).padStart(6, "0")}`;
  g.fillStyle = "#08070e";
  g.fillRect(0, 0, W, H);

  g.fillStyle = accent;
  g.fillRect(0, 0, W, 84);
  g.fillStyle = "rgba(0,0,0,.82)";
  g.font = "800 34px ui-sans-serif, system-ui, sans-serif";
  g.fillText("LEADERBOARD", 30, 55);

  g.fillStyle = "#6f6a8c";
  g.font = "700 18px ui-monospace, Menlo, monospace";
  g.fillText("#", 34, 150);
  g.fillText("TRADER", 96, 150);
  g.textAlign = "right";
  g.fillText("PLANS", W - 300, 150);
  g.fillText("HIT", W - 170, 150);
  g.fillText("RETURN", W - 40, 150);
  g.textAlign = "left";

  rows.forEach((r, i) => {
    const y = 210 + i * 66;
    if (i % 2 === 0) { g.fillStyle = "rgba(255,255,255,.03)"; g.fillRect(24, y - 34, W - 48, 56); }
    g.fillStyle = i === 0 ? accent : "#7b7595";
    g.font = "800 28px ui-monospace, Menlo, monospace";
    g.fillText(String(r.rank), 34, y + 6);
    g.fillStyle = "#ffffff";
    g.font = "700 27px ui-sans-serif, system-ui, sans-serif";
    g.fillText(r.who, 96, y + 6);
    g.textAlign = "right";
    g.fillStyle = "#b8b3cc";
    g.font = "700 26px ui-monospace, Menlo, monospace";
    g.fillText(String(r.plans), W - 300, y + 6);
    g.fillText(r.hit, W - 170, y + 6);
    g.fillStyle = r.ret.startsWith("+") ? "#6bffc4" : "#b8b3cc";
    g.fillText(r.ret, W - 40, y + 6);
    g.textAlign = "left";
  });

  g.fillStyle = "#4f4a68";
  g.font = "600 18px ui-sans-serif, system-ui, sans-serif";
  g.fillText("Standings derive from settled Legs. Not yet wired to the indexer.", 30, H - 46);
  g.fillStyle = "rgba(0,0,0,.16)";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
}
