/**
 * The second display, drawn as an actual Game Boy screen.
 *
 * It renders at the hardware's native **160 x 144** and is upscaled with
 * nearest-neighbour by the CSS (`image-rendering: pixelated`). That is what makes the
 * type genuinely 8-bit — every glyph is quantised to the real pixel grid rather than
 * being a smooth font pretending. Drawing at display resolution and shrinking would
 * give soft, anti-aliased text and lose the whole effect.
 */
/**
 * 2x the DMG's 160x144. Native was too coarse once the panel was scaled up — this
 * keeps every glyph on a hard pixel grid while halving the block size.
 */
export const GB_SCALE = 2;
export const GB_W = 160 * GB_SCALE;
export const GB_H = 144 * GB_SCALE;

/** The DMG's four tones, darkest first. Nothing else may appear on this screen. */
export const GB = {
  darkest: "#0f380f",
  dark: "#306230",
  light: "#8bac0f",
  lightest: "#9bbc0f",
} as const;

/** 8px monospace on a 160px-wide buffer gives ~26 columns — the DMG's own budget. */
const FONT = `${8 * GB_SCALE}px "Courier New", ui-monospace, monospace`;
/** The control rows carry the settings, so they get their own larger size. */
const FONT_BIG = `bold ${11 * GB_SCALE}px "Courier New", ui-monospace, monospace`;

export function clear(g: CanvasRenderingContext2D) {
  g.fillStyle = GB.lightest;
  g.fillRect(0, 0, GB_W, GB_H);
}

export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, tone: string = GB.darkest, big = false) {
  g.fillStyle = tone;
  g.font = big ? FONT_BIG : FONT;
  g.textBaseline = "top";
  // Integer positions only: a half-pixel offset would blur the glyph on upscale.
  g.fillText(s.toUpperCase(), Math.round(x), Math.round(y));
}

/** A 1px frame in the darkest tone, as every DMG menu has. */
export function frame(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.strokeStyle = GB.darkest;
  g.lineWidth = 1;
  g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
}

export function fill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tone: string) {
  g.fillStyle = tone;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/**
 * The price series as a 2D chart, in DMG tones.
 *
 * Used when the displays are swapped and the chart moves off the main screen: the
 * same data, at the resolution this panel can actually carry.
 */
export function priceChart(
  g: CanvasRenderingContext2D,
  points: { t: number; price: number }[],
  x: number, y: number, w: number, h: number,
) {
  if (points.length < 2) {
    text(g, "no feed", x + 4, y + h / 2 - 4, GB.dark);
    return;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) { if (p.price < lo) lo = p.price; if (p.price > hi) hi = p.price; }
  const span = Math.max(hi - lo, 1e-9);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const tSpan = Math.max(t1 - t0, 1);

  // Baseline shading, so the line has a body rather than floating.
  g.fillStyle = GB.light;
  g.beginPath();
  g.moveTo(x, y + h);
  for (const p of points) {
    g.lineTo(x + ((p.t - t0) / tSpan) * w, y + h - ((p.price - lo) / span) * h);
  }
  g.lineTo(x + w, y + h);
  g.closePath();
  g.fill();

  g.strokeStyle = GB.darkest;
  g.lineWidth = 1;
  g.beginPath();
  points.forEach((p, i) => {
    const px = x + ((p.t - t0) / tSpan) * w;
    const py = y + h - ((p.price - lo) / span) * h;
    i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
  });
  g.stroke();
}


/** One row of the control panel. */
export interface MenuRow {
  id: "wallet" | "stake" | "legs" | "window" | "token" | "skin";
  label: string;
  value: string;
  /** A row whose value the scroll can change once it is selected. */
  editable: boolean;
}

/** Everything the panel needs to draw itself. Read once per frame, never stored. */
export interface GbState {
  showChart: boolean;
  points: { t: number; price: number }[];
  legs: { direction: "UP" | "DOWN"; state: string; paid?: bigint }[];
  planId: number | null;
  legCount: number;
  mode: "draw" | "pixel";
  frameNo: number;
  /** Control panel. */
  rows: MenuRow[];
  cursor: number;
  editing: boolean;
  connected: boolean;
}

const U = GB_SCALE;

/**
 * The control panel.
 *
 * This is the device's only settings surface — the stake readout and the connect key
 * both folded in here, so the shell carries two screens and nothing else. The scroll
 * moves the cursor; the centre select enters a row; inside a row the scroll changes
 * the value and the centre confirms. That is why `editing` is drawn differently from
 * `selected`: they are different states and confusing them loses the user.
 */
export function drawGb(g: CanvasRenderingContext2D, s: GbState) {
  clear(g);

  // Status bar.
  fill(g, 0, 0, GB_W, 11 * U, GB.dark);
  text(g, s.showChart ? "BTC/USD" : "KURVV", 3 * U, 2 * U, GB.lightest);
  text(g, s.connected ? "LINKED" : "NO LINK", GB_W - 52 * U, 2 * U, GB.lightest);

  if (s.showChart) {
    priceChart(g, s.points, 3 * U, 14 * U, GB_W - 6 * U, GB_H - 28 * U);
    const last = s.points[s.points.length - 1];
    text(g, last ? `$${Math.round(last.price)}` : "----", 3 * U, GB_H - 11 * U, GB.darkest);
    text(g, `${s.points.length}PT`, GB_W - 34 * U, GB_H - 11 * U, GB.dark);
    return;
  }

  // Rows.
  const rowH = 14 * U;
  const top = 15 * U;
  s.rows.forEach((r, i) => {
    const y = top + i * rowH;
    const on = i === s.cursor;
    if (on) fill(g, 2 * U, y - U, GB_W - 4 * U, rowH - U, s.editing ? GB.dark : GB.light);
    const ink = on && s.editing ? GB.lightest : GB.darkest;
    // The cursor blinks only while editing, so "I am changing this" is unmistakable.
    const mark = on ? (s.editing ? (s.frameNo % 40 < 20 ? "\u25b8" : " ") : "\u25b8") : " ";
    text(g, mark, 4 * U, y, ink, true);
    text(g, r.label, 13 * U, y, on ? ink : GB.dark, true);
    const vx = GB_W - 6 * U - r.value.length * 6.7 * U;
    text(g, r.value, vx, y, ink, true);
  });

  // Plan strip along the bottom: the chain's state, always visible.
  const stripY = GB_H - 24 * U;
  fill(g, 0, stripY, GB_W, 24 * U, GB.dark);
  if (s.planId === null) {
    text(g, "no plan \u00b7 press draw", 4 * U, stripY + 3 * U, GB.lightest);
    text(g, `legs ${s.legCount}`, 4 * U, stripY + 13 * U, GB.light);
  } else {
    const done = s.legs.filter((l) => l.state === "won" || l.state === "lost").length;
    const open = s.legs.filter((l) => l.state === "open").length;
    text(g, `plan #${s.planId}`, 4 * U, stripY + 3 * U, GB.lightest);
    text(g, `${done}/${s.legs.length} settled`, 4 * U, stripY + 13 * U, GB.light);
    // One pip per Leg — an unattended chain advancing is visible at a glance.
    s.legs.slice(0, 8).forEach((l, i) => {
      const x = GB_W - 6 * U - (8 - i) * 7 * U;
      const lit = l.state === "won" || l.state === "lost";
      const blink = l.state === "open" && s.frameNo % 44 < 22;
      fill(g, x, stripY + 8 * U, 5 * U, 7 * U, lit || blink ? GB.lightest : GB.light);
    });
    if (open > 0 && s.frameNo % 60 < 30) text(g, "\u25cf", GB_W - 12 * U, stripY + 2 * U, GB.lightest);
  }
}
