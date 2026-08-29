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
  | "plan" | "coins" | "curve" | "back" | "bolt" | "grid" | "swap" | "mode" | "trophy"
  | "person" | "token" | "gear" | "play";

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

/**
 * Every glyph has to say what the control DOES, at 26px on a moulded cap.
 *
 * A generic pencil, card and cross said "edit", "payment" and "close" — none of
 * which are what these keys do. They now read as: start a new plan, your funds,
 * draw the curve, and step back.
 */
const DRAW: Record<IconName, (g: CanvasRenderingContext2D) => void> = {
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
  // Draw: the gesture itself — a rising curve with the nib on its head.
  curve: (g) => {
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(20, 96);
    g.bezierCurveTo(46, 96, 52, 60, 74, 44);
    g.stroke();
    g.beginPath();
    g.arc(84, 38, 11, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 5;
    g.globalAlpha = 0.55;
    g.beginPath();
    g.moveTo(20, 108); g.lineTo(108, 108);
    g.stroke();
    g.globalAlpha = 1;
  },
  // Step back: an arrow returning.
  back: (g) => {
    g.lineWidth = 8;
    g.beginPath();
    g.arc(70, 66, 30, Math.PI * 0.85, Math.PI * 1.9, false);
    g.stroke();
    g.beginPath();
    g.moveTo(24, 40); g.lineTo(46, 62); g.lineTo(20, 70); g.closePath();
    g.fill();
  },
  // Pixel mode: a canvas half painted.
  grid: (g) => {
    g.lineWidth = 7;
    g.beginPath();
    g.roundRect(24, 24, 80, 80, 7);
    g.stroke();
    g.fillRect(24, 64, 40, 40);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(64, 24); g.lineTo(64, 104);
    g.moveTo(24, 64); g.lineTo(104, 64);
    g.stroke();
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
  // The trader: their name, their standings, their record.
  person: (g) => {
    g.lineWidth = 8;
    g.beginPath();
    g.arc(64, 44, 20, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(64, 118, 38, Math.PI * 1.16, Math.PI * 1.84);
    g.stroke();
  },
  // Which asset the chart is following.
  token: (g) => {
    g.lineWidth = 8;
    g.beginPath();
    g.ellipse(64, 40, 34, 14, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(30, 40); g.lineTo(30, 88);
    g.bezierCurveTo(30, 100, 98, 100, 98, 88);
    g.lineTo(98, 40);
    g.stroke();
    g.beginPath();
    g.moveTo(30, 64); g.bezierCurveTo(30, 76, 98, 76, 98, 64);
    g.stroke();
  },
  // Settings.
  gear: (g) => {
    g.lineWidth = 8;
    const R = 30;
    const r = 13;
    g.beginPath();
    g.arc(64, 64, r, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(64, 64, R, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 12;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * (R - 2), 64 + Math.sin(a) * (R - 2));
      g.lineTo(64 + Math.cos(a) * (R + 14), 64 + Math.sin(a) * (R + 14));
      g.stroke();
    }
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
