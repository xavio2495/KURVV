import * as THREE from "three";

/**
 * Wheel glyphs, drawn procedurally.
 *
 * Every icon is painted WHITE on transparent and tinted at render time by the
 * material's `color`, so one texture serves the lit, dimmed and pressed states of a
 * control. That is what lets the backlight carry the enabled/disabled state instead
 * of a second set of assets.
 */
export type IconName =
  | "plan" | "coins" | "pen" | "back" | "bolt" | "grid" | "swap" | "mode" | "trophy"
  | "person" | "token" | "gear" | "play" | "bird" | "up" | "down" | "check";

const S = 128;

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d")!;
  g.strokeStyle = "#fff";
  g.fillStyle = "#fff";
  g.lineWidth = 9;
  g.lineCap = "round";
  g.lineJoin = "round";
  return [c, g];
}

const TAU = Math.PI * 2;

/**
 * Every glyph has to say what the control DOES, at 26px on a moulded cap.
 *
 * Two rules, learned the hard way at that size. FILLED SHAPES BEAT OUTLINES: a
 * stroked arc and a stroked circle are the same smudge on a 26px cap, and the
 * difference between them was carrying meaning. And ONE IDEA PER GLYPH: the old
 * back key drew an arc AND an arrowhead pointing somewhere else, the old asset key
 * drew a cylinder that read as a database, and both cost a beat of thought that a
 * hardware control does not get.
 *
 * These are also SWAPPED AT RUNTIME by `setGlyph`, so a key that means something
 * different in another mode says so on its own face rather than in a legend.
 */
const DRAW: Record<IconName, (g: CanvasRenderingContext2D) => void> = {
  // Draw mode: a nib, angled, with the line it has just laid down.
  pen: (g) => {
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(94, 18);
    g.lineTo(112, 36);
    g.lineTo(54, 94);
    g.lineTo(26, 104);
    g.lineTo(36, 76);
    g.closePath();
    g.stroke();
    // The slit, which is what makes it a nib rather than a wedge.
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(36, 76); g.lineTo(54, 94);
    g.stroke();
    g.globalAlpha = 0.5;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(18, 116); g.lineTo(106, 116);
    g.stroke();
    g.globalAlpha = 1;
  },
  // Flappy: the bird, filled, with the wing and eye cut back out of it.
  bird: (g) => {
    g.beginPath();
    g.arc(56, 64, 28, 0, TAU);
    g.fill();
    g.beginPath();
    g.moveTo(80, 56); g.lineTo(112, 65); g.lineTo(80, 76);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.arc(66, 52, 7, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(50, 74, 16, 9, -0.35, 0, TAU);
    g.fill();
    g.globalCompositeOperation = "source-over";
  },
  // Flap up / step up. A solid arrow: at cap size a chevron alone reads as a crease.
  up: (g) => {
    g.beginPath();
    g.moveTo(64, 22); g.lineTo(104, 66); g.lineTo(24, 66);
    g.closePath();
    g.fill();
    g.fillRect(50, 66, 28, 40);
  },
  down: (g) => {
    g.beginPath();
    g.moveTo(64, 106); g.lineTo(104, 62); g.lineTo(24, 62);
    g.closePath();
    g.fill();
    g.fillRect(50, 22, 28, 40);
  },
  // Confirm — what the centre key does on a list rather than on a chart.
  check: (g) => {
    g.lineWidth = 15;
    g.beginPath();
    g.moveTo(26, 66); g.lineTo(52, 94); g.lineTo(104, 34);
    g.stroke();
  },
  // New plan: a fresh sheet with a plus.
  plan: (g) => {
    g.lineWidth = 8;
    g.beginPath();
    g.roundRect(28, 20, 62, 82, 8);
    g.stroke();
    g.beginPath();
    g.moveTo(59, 44); g.lineTo(59, 78);
    g.moveTo(42, 61); g.lineTo(76, 61);
    g.stroke();
  },
  // Funds: a stack of coins, not a payment card.
  coins: (g) => {
    g.lineWidth = 7;
    for (const y of [86, 66, 46]) {
      g.beginPath();
      g.ellipse(64, y, 36, 13, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(28, 46); g.lineTo(28, 86);
    g.moveTo(100, 46); g.lineTo(100, 86);
    g.stroke();
  },
  // Step back. It sits on the LEFT of the wheel, so it points left — a returning
  // arc pointed up and to the right, which is the one direction it never goes.
  back: (g) => {
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(106, 64); g.lineTo(40, 64);
    g.stroke();
    g.beginPath();
    g.moveTo(22, 64); g.lineTo(58, 34); g.lineTo(58, 94);
    g.closePath();
    g.fill();
  },
  // Grid mode: cells placed above and below the line that separates UP from DOWN.
  // The line is the whole point of the mode, so it is the loudest thing in the glyph.
  grid: (g) => {
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(18, 26, 92, 76, 6);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(18, 64); g.lineTo(110, 64);
    g.stroke();
    g.fillRect(32, 36, 22, 22);
    g.fillRect(74, 70, 22, 22);
  },
  // Swap: two panels exchanging places.
  swap: (g) => {
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(16, 22, 42, 40, 6);
    g.roundRect(70, 66, 42, 40, 6);
    g.stroke();
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(66, 42); g.lineTo(104, 42); g.moveTo(92, 30); g.lineTo(104, 42); g.lineTo(92, 54);
    g.moveTo(62, 86); g.lineTo(24, 86); g.moveTo(36, 74); g.lineTo(24, 86); g.lineTo(36, 98);
    g.stroke();
  },
  // Mode: the two input modes, one active.
  mode: (g) => {
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(18, 84);
    g.bezierCurveTo(40, 84, 44, 50, 62, 40);
    g.stroke();
    g.beginPath();
    g.roundRect(70, 56, 42, 42, 5);
    g.stroke();
    g.fillRect(70, 77, 21, 21);
  },
  // Standings: a cup on its plinth.
  trophy: (g) => {
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(40, 22); g.lineTo(88, 22); g.lineTo(84, 60);
    g.bezierCurveTo(82, 76, 74, 82, 64, 82);
    g.bezierCurveTo(54, 82, 46, 76, 44, 60);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(40, 30); g.bezierCurveTo(20, 32, 20, 56, 42, 58);
    g.moveTo(88, 30); g.bezierCurveTo(108, 32, 108, 56, 86, 58);
    g.stroke();
    g.beginPath();
    g.moveTo(64, 82); g.lineTo(64, 96);
    g.stroke();
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(42, 104); g.lineTo(86, 104);
    g.stroke();
  },
  // The trader: their name, their standings, their record. Filled, because two
  // stroked arcs at cap size are two smudges rather than a person.
  person: (g) => {
    g.beginPath();
    g.arc(64, 42, 21, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(64, 112, 38, Math.PI, 0);
    g.closePath();
    g.fill();
  },
  // Which asset the chart is following, and that the key steps to the next one.
  // The old cylinder read as a database; a coin with a candle in it reads as an
  // instrument, and the chevron says the key cycles.
  token: (g) => {
    g.lineWidth = 8;
    g.beginPath();
    g.arc(54, 64, 31, 0, TAU);
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(44, 50); g.lineTo(44, 80);
    g.moveTo(62, 42); g.lineTo(62, 88);
    g.stroke();
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(96, 44); g.lineTo(114, 64); g.lineTo(96, 84);
    g.stroke();
  },
  // Settings.
  gear: (g) => {
    const R = 27;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(64, 64, R, 0, TAU);
    g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * (R + 1), 64 + Math.sin(a) * (R + 1));
      g.lineTo(64 + Math.cos(a) * (R + 16), 64 + Math.sin(a) * (R + 16));
      g.stroke();
    }
    // The bore, cut out rather than stroked, so the ring never fills in at size.
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.arc(64, 64, 11, 0, TAU);
    g.fill();
    g.globalCompositeOperation = "source-over";
  },
  // The game mode selector.
  play: (g) => {
    g.beginPath();
    g.moveTo(46, 30);
    g.lineTo(102, 64);
    g.lineTo(46, 98);
    g.closePath();
    g.fill();
  },
  // Commit: the transaction going out.
  bolt: (g) => {
    g.beginPath();
    g.moveTo(74, 16);
    g.lineTo(38, 72);
    g.lineTo(62, 72);
    g.lineTo(52, 112);
    g.lineTo(92, 54);
    g.lineTo(68, 54);
    g.closePath();
    g.fill();
  },
};

export function iconTexture(name: IconName): THREE.Texture {
  const [c, g] = canvas();
  DRAW[name](g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A soft radial bloom, used additively as the backlight behind each glyph. */
export function glowTexture(): THREE.Texture {
  const [c, g] = canvas();
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.42, "rgba(255,255,255,0.34)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/**
 * A short silkscreen caption. The size is FITTED to the canvas, because a fixed size
 * clips the long words against a fixed-width texture.
 */
export function textTexture(label: string, colour: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  const spacing = 8;
  let px = 92;
  const fits = () => {
    g.font = `700 ${px}px -apple-system, "Segoe UI", system-ui, sans-serif`;
    return g.measureText(label).width + spacing * label.length <= c.width - 28;
  };
  while (px > 20 && !fits()) px -= 2;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = colour;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.letterSpacing = `${spacing}px`;
  g.fillText(label.toUpperCase(), c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
