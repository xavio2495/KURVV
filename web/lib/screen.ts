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
  name: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.arc(x, y - 5, 6, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y + 15, 12, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); },
  stake: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; for (const dy of [6, 0, -6]) { g.beginPath(); g.ellipse(x, y + dy, 11, 4.5, 0, 0, Math.PI * 2); g.stroke(); } },
  legs: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 13, y + 8); g.lineTo(x - 4, y + 8); g.lineTo(x - 4, y - 2); g.lineTo(x + 5, y - 2); g.lineTo(x + 5, y - 9); g.lineTo(x + 13, y - 9); g.stroke(); },
  window: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x, y); g.lineTo(x + 5, y + 3); g.stroke(); },
  token: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(x, y - 13); g.lineTo(x, y + 13); g.stroke(); },
  skin: (g, x, y, c) => { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.roundRect(x - 12, y - 12, 24, 24, 5); g.stroke(); g.fillStyle = c; g.fillRect(x - 12, y, 24, 12); },
};

/**
 * Where each row sits, so a tap on the glass can be turned back into a row index.
 *
 * Sized for SEVEN rows, not six. The NAME row appears once a wallet is connected, and
 * at the old 210/84 the seventh row's selection block ran from 680 to 750 — straight
 * under the button-hint footer, which starts at 688. Row 6 now ends at 670.
 */
export const PANEL_ROWS = { top: 200, height: 74 };
export function rowAtUV(v: number, count: number): number {
  // `v` is bottom-up; the list is drawn top-down.
  const y = (1 - v) * MAIN_H;
  const i = Math.floor((y - PANEL_ROWS.top + PANEL_ROWS.height / 2) / PANEL_ROWS.height);
  return i >= 0 && i < count ? i : -1;
}

/**
 * The open dropdown's geometry, shared by the renderer and the hit test.
 *
 * One source for both, because a menu you can see but not press — or press but not
 * see — is the specific bug a second copy of these numbers produces.
 */
export const OPTION_H = 62;
/** The band a dropdown may occupy. Outside it there is title bar or footer. */
const OPTION_TOP = 96;
const OPTION_BOTTOM = MAIN_H - 100;

/**
 * The open dropdown's box, and the row height that made it fit.
 *
 * The height is per-instance, not a constant: NAME offers twelve handle variants, and
 * twelve rows at the full 62px is 760px on a 780px surface. The old version let it
 * overflow, so the last options were drawn off-canvas AND sat at coordinates no `v`
 * can produce — visible in neither sense, and unreachable by tap. Long lists tighten
 * instead of overflowing, which keeps every option on the glass.
 */
export function optionBox(rowIndex: number, count: number) {
  const oh = Math.max(28, Math.min(OPTION_H, Math.floor((OPTION_BOTTOM - OPTION_TOP - 16) / Math.max(count, 1))));
  const height = count * oh + 16;
  const top = PANEL_ROWS.top + rowIndex * PANEL_ROWS.height + PANEL_ROWS.height / 2 - 22;
  // Flip upward when it would run off the bottom, then clamp into the band.
  const wanted = top + height > OPTION_BOTTOM ? top - height - PANEL_ROWS.height + 24 : top;
  const y = Math.max(OPTION_TOP, Math.min(wanted, OPTION_BOTTOM - height));
  return { x: 340, y, w: MAIN_W - 340 - 40, h: height, oh };
}

/** Which option a tap landed on, or -1. */
export function optionAtUV(v: number, rowIndex: number, count: number): number {
  const y = (1 - v) * MAIN_H;
  const box = optionBox(rowIndex, count);
  if (y < box.y + 8 || y > box.y + box.h - 8) return -1;
  const i = Math.floor((y - box.y - 8) / box.oh);
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
  /**
   * The open dropdown.
   *
   * On the big display this panel is a TOUCH surface, and a touch surface whose only
   * way to change a value is "select the row, then turn a wheel you are not holding"
   * is a control that does not work where it is being used. A tap opens the list; a
   * tap picks from it.
   */
  open: { row: number; options: readonly string[]; selected: number } | null = null,
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

  // ── the open dropdown, over everything ──
  if (open && open.options.length) {
    const box = optionBox(open.row, open.options.length);
    g.fillStyle = "rgba(0,0,0,.55)";
    g.fillRect(0, PANEL_ROWS.top - 60, W, H - PANEL_ROWS.top - 30);

    g.fillStyle = "#12101c";
    g.strokeStyle = accent;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(box.x, box.y, box.w, box.h, 16);
    g.fill();
    g.stroke();

    open.options.forEach((label, i) => {
      const oy = box.y + 8 + i * box.oh;
      const on = i === open.selected;
      if (on) {
        g.fillStyle = accent;
        g.fillRect(box.x + 8, oy + 4, box.w - 16, box.oh - 8);
      }
      g.fillStyle = on ? "#08070e" : "#e8eaed";
      g.font = `${on ? 800 : 700} 30px ui-monospace, Menlo, monospace`;
      g.fillText(label, box.x + 28, oy + box.oh / 2 + 8);
      if (on) {
        g.textAlign = "right";
        g.fillText("\u25c2", box.x + box.w - 24, oy + box.oh / 2 + 8);
        g.textAlign = "left";
      }
    });
  }

  // ── button hints ──
  const fy = H - 46;
  g.fillStyle = "rgba(255,255,255,.045)";
  g.fillRect(0, H - 92, W, 92);
  const hints: [string, string][] = open
    ? [["\u261d", "TAP TO PICK"], ["\u21ba", "CLOSE"]]
    : editing
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
/**
 * PROOF OF AUTONOMY, on the device's own screen.
 *
 * The product's central claim is that nobody sends the Legs — validators do. That is
 * invisible unless the evidence is on screen, so this panel puts the raw `from`
 * field of every handler invocation in front of the viewer.
 *
 * `from == to == the PlanBook contract` is a shape no private key can produce: a
 * contract has no key to sign with, and the transaction was assembled by validators
 * when the subscription filter matched. The one transaction the human signed sits in
 * the same list in the opposite colour, and the contrast between the one and the
 * many is the entire story.
 */
export interface FireRow {
  synthetic: boolean;
  kind: string;
  summary: string;
  timestamp: number;
  gasUsed: bigint;
  hash: string;
}

export function drawAutonomy(
  g: CanvasRenderingContext2D,
  rows: FireRow[],
  skin: Skin,
  state: { scanning: boolean; error: string | null; hasPlan: boolean; nextOpenSec: number | null },
) {
  const W = MAIN_W;
  const H = MAIN_H;
  const accent = `#${skin.lanes[0].toString(16).padStart(6, "0")}`;
  const VALIDATOR = "#6bffc4";
  const HUMAN = "#f0a030";

  g.fillStyle = "#08070e";
  g.fillRect(0, 0, W, H);

  g.fillStyle = accent;
  g.fillRect(0, 0, W, 84);
  g.fillStyle = "rgba(0,0,0,.82)";
  g.font = "800 34px ui-sans-serif, system-ui, sans-serif";
  g.fillText("WHO SENT THIS", 30, 55);

  const synthetic = rows.filter((r) => r.synthetic).length;
  const human = rows.length - synthetic;
  g.font = "800 19px ui-monospace, Menlo, monospace";
  g.textAlign = "right";
  g.fillText(`${synthetic} VALIDATOR \u00b7 ${human} SIGNED`, W - 30, 55);
  g.textAlign = "left";

  // The counter, which is the claim in one line.
  g.fillStyle = "#0d0b16";
  g.fillRect(24, 108, W - 48, 96);
  g.fillStyle = VALIDATOR;
  g.font = "800 62px ui-monospace, Menlo, monospace";
  g.fillText(String(synthetic), 44, 176);
  const wNum = g.measureText(String(synthetic)).width;
  g.fillStyle = "#6f6a8c";
  g.font = "600 21px ui-sans-serif, system-ui, sans-serif";
  g.fillText("transactions nobody signed", 44 + wNum + 20, 160);
  g.fillStyle = "#4f4a68";
  g.font = "500 17px ui-sans-serif, system-ui, sans-serif";
  g.fillText("from == to == the Plan contract \u00b7 a contract holds no key", 44 + wNum + 20, 188);

  if (state.nextOpenSec !== null && state.nextOpenSec > 0) {
    g.textAlign = "right";
    g.fillStyle = HUMAN;
    g.font = "800 34px ui-monospace, Menlo, monospace";
    g.fillText(`T-${Math.floor(state.nextOpenSec)}s`, W - 44, 168);
    g.fillStyle = "#6f6a8c";
    g.font = "600 15px ui-sans-serif, system-ui, sans-serif";
    g.fillText("next open", W - 44, 190);
    g.textAlign = "left";
  }

  if (!rows.length) {
    g.fillStyle = "#4f4a68";
    g.font = "600 22px ui-sans-serif, system-ui, sans-serif";
    const msg = state.error
      ? `log read failed \u00b7 ${state.error.slice(0, 46)}`
      : !state.hasPlan
        ? "commit a Plan, then watch the chain run it"
        : state.scanning ? "scanning the Plan's own logs\u2026" : "waiting for the first fire\u2026";
    g.fillText(msg, 44, 272);
    return;
  }

  // Newest first: the thing that just happened is the thing being pointed at.
  const list = [...rows].reverse().slice(0, 6);
  list.forEach((r, i) => {
    const y = 250 + i * 84;
    const tone = r.synthetic ? VALIDATOR : HUMAN;
    g.fillStyle = "rgba(255,255,255,.03)";
    g.fillRect(24, y - 28, W - 48, 72);
    g.fillStyle = tone;
    g.fillRect(24, y - 28, 5, 72);

    g.fillStyle = tone;
    g.font = "800 19px ui-monospace, Menlo, monospace";
    g.fillText(r.synthetic ? "VALIDATOR" : "YOU SIGNED THIS", 46, y - 4);

    g.fillStyle = "#6f6a8c";
    g.font = "500 16px ui-monospace, Menlo, monospace";
    g.textAlign = "right";
    g.fillText(`${Number(r.gasUsed).toLocaleString("en-US")} gas`, W - 44, y - 4);
    g.textAlign = "left";

    g.fillStyle = "#e8eaed";
    g.font = "600 21px ui-sans-serif, system-ui, sans-serif";
    const text = r.summary.length > 58 ? `${r.summary.slice(0, 57)}\u2026` : r.summary;
    g.fillText(text, 46, y + 26);
  });
}

export function drawBoard(
  g: CanvasRenderingContext2D,
  rows: { rank: number; who: string; plans: number; hit: string; ret: string; you?: boolean }[],
  skin: Skin,
  sample = false,
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
  // Standings nobody earned must never be mistaken for standings somebody did.
  if (sample) {
    g.font = "800 19px ui-monospace, Menlo, monospace";
    g.textAlign = "right";
    g.fillText("SAMPLE \u00b7 NO PLANS ON CHAIN YET", W - 30, 55);
    g.textAlign = "left";
  }

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
    if (r.you) {
      // The trader's own row, so a board of derived names is still navigable.
      g.fillStyle = `${accent}22`;
      g.fillRect(24, y - 34, W - 48, 56);
      g.fillStyle = accent;
      g.fillRect(24, y - 34, 4, 56);
    } else if (i % 2 === 0) {
      g.fillStyle = "rgba(255,255,255,.03)";
      g.fillRect(24, y - 34, W - 48, 56);
    }
    g.fillStyle = i === 0 ? accent : "#7b7595";
    g.font = "800 28px ui-monospace, Menlo, monospace";
    g.fillText(String(r.rank), 34, y + 6);
    g.fillStyle = "#ffffff";
    g.font = "700 27px ui-sans-serif, system-ui, sans-serif";
    g.fillText(r.who, 96, y + 6);
    if (r.you) {
      const w = g.measureText(r.who).width;
      g.fillStyle = accent;
      g.font = "800 18px ui-monospace, Menlo, monospace";
      g.fillText("YOU", 96 + w + 14, y + 4);
    }
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
  g.fillText(
    sample
      ? "Illustrative standings. Real ones appear once Plans settle on chain."
      : "Read from the Plan contract. Names derive from each trader's address.",
    30, H - 46);
  g.fillStyle = "rgba(0,0,0,.16)";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
}
