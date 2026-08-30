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

/** The play readout is read at a glance across a room; it gets the largest face. */
const FONT_HUGE = `bold ${17 * GB_SCALE}px "Courier New", ui-monospace, monospace`;

export function textBig(g: CanvasRenderingContext2D, s: string, x: number, y: number, tone: string = GB.darkest) {
  g.fillStyle = tone;
  g.font = FONT_HUGE;
  g.textBaseline = "top";
  g.fillText(s.toUpperCase(), Math.round(x), Math.round(y));
}

/** One pip per Leg — an unattended chain advancing is visible at a glance. */
export function legPips(
  g: CanvasRenderingContext2D,
  legs: { state: string }[],
  x: number, y: number,
) {
  legs.forEach((l, i) => {
    const px = x + i * 7 * GB_SCALE;
    // A void is settled, so it must read as settled — the counter beside these pips
    // includes it, and a pip left at the pending tone made "3/6 settled" sit next to
    // two lit squares.
    const tone = l.state === "won" ? GB.lightest
      : l.state === "lost" ? GB.darkest
      : l.state === "void" ? GB.light
      : l.state === "open" ? GB.light : GB.dark;
    fill(g, px, y, 5 * GB_SCALE, 5 * GB_SCALE, tone);
    frame(g, px, y, 5 * GB_SCALE, 5 * GB_SCALE);
  });
}

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

/** One row of the control panel. */
export interface MenuRow {
  id: "wallet" | "name" | "stake" | "legs" | "window" | "token" | "skin";
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
  mode: "draw" | "pixel" | "flappy";
  /** Which asset the chart is showing. */
  asset?: string;
  /** Whether the chosen venue has an open Window. `null` while unknown. */
  venueLive?: boolean | null;
  /**
   * True while the chart holds the main display — the state the user plays in.
   * The panel then carries only what a player needs mid-gesture, not the settings.
   */
  playing?: boolean;
  /** How the rehearsal did. `resolved` excludes voided and unsettled Windows. */
  score?: { hit: number; resolved: number; placed: number } | null;
  /** Wallet balance in collateral base units, shown while playing. */
  balance?: bigint | null;
  /** Total stake the Plan will commit, in base units. */
  stake?: bigint;
  /**
   * THE BETS THE LIVE GESTURE HAS MADE.
   *
   * Whatever the mode, a gesture ends at the same thing: a direction and a size per
   * Window. Drawing that — rather than the mode's own input — is what lets this panel
   * answer "what have I actually got on" identically in all three, and it updates as
   * the Curve is drawn, as cells are painted, and as a flight is called.
   */
  plan?: { direction: "UP" | "DOWN"; stake: bigint }[];
  frameNo: number;
  /** Control panel. */
  rows: MenuRow[];
  cursor: number;
  editing: boolean;
  connected: boolean;
}

const U = GB_SCALE;

/**
 * THE MODE BAND — the bottom of this panel, and the only place the mode is named.
 *
 * It used to be a banner across the middle of the main display, floating over the
 * chart it was describing. That is the worst place for it: the chart is the thing
 * being read, the mode never changes while it is being read, and a permanent label
 * over live data is a label that stops being seen within a minute. Here it is
 * legible across a room, out of the way of everything, and always in the same place.
 */
const MODE_H = 26 * U;
const MODE_LABEL: Record<GbState["mode"], string> = {
  draw: "DRAW", pixel: "GRID", flappy: "FLAPPY",
};

function modeBand(g: CanvasRenderingContext2D, s: GbState) {
  const y = GB_H - MODE_H;
  fill(g, 0, y, GB_W, MODE_H, GB.darkest);
  textBig(g, MODE_LABEL[s.mode], 5 * U, y + 5 * U, GB.lightest);
  const n = s.plan?.length ?? 0;
  const right = s.venueLive === false ? "CLOSED"
    : n ? `${n} BET${n === 1 ? "" : "S"}`
    : s.mode === "flappy" ? "FLYING" : "OPEN";
  // 6.7px per character is the FONT_BIG advance, measured against the settings rows
  // that use the same face. At 4.9 the longest labels ran off the right edge.
  text(g, right, GB_W - 5 * U - right.length * 6.7 * U, y + 10 * U, GB.light, true);
}

/**
 * What the live gesture has bet, drawn the same way in every mode.
 *
 * One column per Leg, rising from a centre line for UP and falling for DOWN, its
 * height the share of the stake. Once a Plan is committed the same columns carry
 * their settled tone, so the picture the player made and the result the chain
 * returned are the same picture.
 */
function betChart(g: CanvasRenderingContext2D, s: GbState, y: number, h: number) {
  const plan = s.plan ?? [];
  const mid = y + h / 2;
  g.strokeStyle = GB.dark;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(4 * U, mid + 0.5);
  g.lineTo(GB_W - 4 * U, mid + 0.5);
  g.stroke();

  if (!plan.length) {
    const line = s.mode === "flappy" ? "call up or down as they pass"
      : s.mode === "pixel" ? "paint a cell per window"
      : "draw a curve on the chart";
    text(g, "no bets yet", 6 * U, mid - 11 * U, GB.dark);
    text(g, line, 6 * U, mid + 3 * U, GB.dark);
    return;
  }

  const max = plan.reduce((m, l) => (l.stake > m ? l.stake : m), 1n);
  const pad = 5 * U;
  const cw = (GB_W - pad * 2) / plan.length;
  plan.forEach((leg, i) => {
    // Scaled against the biggest Leg, not against the total: at eight Legs a share
    // of the total is a bar three pixels tall and the whole row reads as empty.
    const frac = Number(leg.stake) / Number(max);
    const bh = Math.max(3 * U, Math.round(frac * (h / 2 - 6 * U)));
    const x = pad + i * cw;
    const w = Math.max(3 * U, cw - 2 * U);
    const state = s.legs[i]?.state;
    const tone = state === "won" ? GB.lightest
      : state === "lost" ? GB.darkest
      : state === "open" && s.frameNo % 40 < 20 ? GB.lightest
      : state ? GB.light : GB.dark;
    const top = leg.direction === "UP" ? mid - bh : mid;
    fill(g, x, top, w, bh, tone);
    frame(g, x, top, w, bh);
  });
}

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
  text(g, s.showChart ? `${s.asset ?? "BTC"}/USD` : "KURVV", 3 * U, 2 * U, GB.lightest);
  text(g, s.connected ? "LINKED" : "NO LINK", GB_W - 52 * U, 2 * U, GB.lightest);

  if (s.showChart) {
    // The main display is carrying something else — the settings list, the
    // standings, the fire feed, or a flight. So this panel carries the bets, which
    // is the one thing the player has going that none of those show.
    text(g, "BETS", 4 * U, 14 * U, GB.darkest, true);
    const staked = (s.plan ?? []).reduce((a, l) => a + l.stake, 0n);
    const money = `$${(Number(staked) / 1e6).toFixed(2)}`;
    text(g, money, GB_W - 5 * U - money.length * 6.7 * U, 14 * U, GB.dark, true);

    betChart(g, s, 28 * U, GB_H - MODE_H - 46 * U);

    const foot = GB_H - MODE_H - 16 * U;
    if (s.planId !== null) {
      const done = s.legs.filter((l) => l.state === "won" || l.state === "lost" || l.state === "void").length;
      text(g, `plan #${s.planId}`, 4 * U, foot, GB.darkest);
      text(g, `${done}/${s.legs.length} settled`, 4 * U, foot + 9 * U, GB.dark);
      legPips(g, s.legs, GB_W - 4 * U - s.legs.length * 7 * U, foot + 9 * U);
    } else if (s.mode === "flappy" && s.score && s.score.placed) {
      text(g, `hit ${s.score.hit}/${s.score.resolved}`, 4 * U, foot, GB.darkest);
      text(g, "rehearsal · past windows", 4 * U, foot + 9 * U, GB.dark);
    } else {
      const last = s.points[s.points.length - 1];
      text(g, last ? `${s.asset ?? "BTC"} $${Math.round(last.price)}` : "no feed", 4 * U, foot, GB.darkest);
      text(g, s.venueLive === false ? "window closed" : "not committed", 4 * U, foot + 9 * U, GB.dark);
    }

    modeBand(g, s);
    return;
  }

  /**
   * PLAY MODE — three numbers and nothing else.
   *
   * While the chart is on the main display the user is drawing, not configuring, and
   * a six-row settings list on the second screen is a list nobody is reading. The
   * settings surface is one swap away and is touch-driven there; here the panel
   * answers only the questions a player asks mid-gesture: what am I risking, what do
   * I have, and how many Legs will it become.
   */
  if (s.playing) {
    const money = (v: bigint | null | undefined, dp = 2) =>
      v === null || v === undefined ? "----" : (Number(v) / 1e6).toFixed(dp);

    const big = (label: string, value: string, y: number, invert = false) => {
      if (invert) fill(g, 2 * U, y - 2 * U, GB_W - 4 * U, 22 * U, GB.light);
      text(g, label, 6 * U, y, invert ? GB.darkest : GB.dark);
      textBig(g, value, 6 * U, y + 8 * U, GB.darkest);
    };

    big("STAKE", `$${money(s.stake)}`, 16 * U, true);
    big("BALANCE", `$${money(s.balance)}`, 44 * U);
    big("LEGS", String(s.legCount), 72 * U);

    // The Plan's own state still belongs here \u2014 it is the one thing that changes
    // without the user touching anything.
    const stripY = GB_H - MODE_H - 22 * U;
    fill(g, 0, stripY, GB_W, 22 * U, GB.dark);
    if (s.venueLive === false) {
      text(g, "no market open", 4 * U, stripY + 3 * U, GB.lightest);
      text(g, `${s.asset ?? ""} window closed`, 4 * U, stripY + 12 * U, GB.light);
    } else if (s.planId === null) {
      const n = s.plan?.length ?? 0;
      text(g, n ? `${n} legs ready` : s.mode === "pixel" ? "paint a grid" : "draw a curve",
        4 * U, stripY + 3 * U, GB.lightest);
      text(g, n ? "centre = commit" : "scroll = stake", 4 * U, stripY + 12 * U, GB.light);
    } else {
      const done = s.legs.filter((l) => l.state === "won" || l.state === "lost" || l.state === "void").length;
      text(g, `plan #${s.planId}`, 4 * U, stripY + 3 * U, GB.lightest);
      text(g, `${done}/${s.legs.length} settled`, 4 * U, stripY + 12 * U, GB.light);
      legPips(g, s.legs, GB_W - 4 * U - s.legs.length * 7 * U, stripY + 12 * U);
    }
  }

  // The mode, last and largest, on every branch.
  modeBand(g, s);
}
