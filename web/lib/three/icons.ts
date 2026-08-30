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
  | "pen" | "grid" | "bird" | "up" | "down" | "check"
  | "back" | "bolt" | "person" | "token" | "gear" | "play";

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
