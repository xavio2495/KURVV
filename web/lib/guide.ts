import type { Skin } from "./skins";
import { MAIN_H, MAIN_W } from "./screen";

/**
 * HOW EACH MODE WORKS, in the machine's own words.
 *
 * Three modes produce the SAME on-chain payload — a direction and a size per Window —
 * from three different gestures, and nothing on the device ever said so. A player who
 * opened grid mode saw a lattice with no legend and a centre row that looks like a
 * small bet but means "skip". That is not a thing anyone guesses.
 *
 * Written as steps rather than prose because it is read on a screen across a desk,
 * and the last line of each is always the same claim, deliberately: whatever you
 * drew, the chain runs it without you.
 */
export interface GuidePage {
  title: string;
  subtitle: string;
  steps: [string, string][];
  footer: string;
}

export const GUIDES: Record<"draw" | "pixel" | "flappy", GuidePage> = {
  draw: {
    title: "DRAW",
    subtitle: "One line becomes a schedule of positions",
    steps: [
      ["Draw across the future", "Press the pencil, then drag a line to the right of NOW. The past cannot be bet on."],
      ["Slope picks the side", "A segment that rises is UP for that Window. One that falls is DOWN."],
      ["Steepness picks the size", "Conviction is the slope, normalised. A sharp rise stakes more than a gentle one."],
      ["Windows are the columns", "Each vertical band is one expiry. Six Legs on the 60s window is six minutes."],
    ],
    footer: "Flat-then-sharp and steadily-rising end in the same place and are NOT the same Plan.",
  },
  pixel: {
    title: "GRID",
    subtitle: "Paint a cell per Window",
    steps: [
      ["One cell per column", "Each column is a Window. Paint at most one cell in it; leave it blank to sit out."],
      ["Above centre is UP", "Below centre is DOWN. Which half you paint in is the direction, nothing else."],
      ["Distance is SIZE, not price", "Rows are conviction, NOT price levels. Further from centre stakes more."],
      ["The centre row is SKIP", "It is not a small bet. That Window is simply not traded."],
    ],
    footer: "Same payload as a drawn Curve: a direction and a stake per Window. No extra contract.",
  },
  flappy: {
    title: "FLAPPY",
    subtitle: "Call each Window as it reaches you",
    steps: [
      ["Tap top or bottom", "Top calls UP for the Window ahead of the bird. Bottom calls DOWN."],
      ["The gate is a half-plane", "It is anchored at the Window's reference level. Above it is UP, below is DOWN."],
      ["Only the close counts", "The bird's path is animation. The outcome is the settled result, not the flight."],
      ["Calls replace, not stack", "Tapping twice for the same Window overwrites it. One call per Window."],
    ],
    footer: "Fast venues only — a Window with no published reference has no gate to anchor.",
  },
};

/**
 * The guide on the big display.
 *
 * A full channel rather than an overlay: the thing being explained is the OTHER
 * channel, so drawing the explanation on top of it would cover the diagram it refers
 * to and leave the player reading through their own Curve.
 */
export function drawGuide(
  g: CanvasRenderingContext2D,
  mode: "draw" | "pixel" | "flappy",
  skin: Skin,
) {
  const page = GUIDES[mode];
  const W = MAIN_W;
  const H = MAIN_H;
  const accent = `#${skin.lanes[0].toString(16).padStart(6, "0")}`;

  g.fillStyle = "#08070e";
  g.fillRect(0, 0, W, H);

  g.fillStyle = accent;
  g.fillRect(0, 0, W, 84);
  g.fillStyle = "rgba(0,0,0,.82)";
  g.font = "800 34px ui-sans-serif, system-ui, sans-serif";
  g.fillText(`HOW ${page.title} WORKS`, 30, 55);
  g.font = "800 19px ui-monospace, Menlo, monospace";
  g.textAlign = "right";
  g.fillText("◂ BACK", W - 30, 55);
  g.textAlign = "left";

  g.fillStyle = "#b8b3cc";
  g.font = "600 24px ui-sans-serif, system-ui, sans-serif";
  g.fillText(page.subtitle, 32, 138);

  page.steps.forEach(([head, body], i) => {
    const y = 200 + i * 118;
    // A numbered disc, so the order is the order even when the text wraps.
    g.fillStyle = accent;
    g.beginPath();
    g.arc(58, y + 6, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#08070e";
    g.font = "800 26px ui-monospace, Menlo, monospace";
    g.textAlign = "center";
    g.fillText(String(i + 1), 58, y + 15);
    g.textAlign = "left";

    g.fillStyle = "#ffffff";
    g.font = "800 27px ui-sans-serif, system-ui, sans-serif";
    g.fillText(head, 100, y + 2);

    g.fillStyle = "#8b86a6";
    g.font = "500 21px ui-sans-serif, system-ui, sans-serif";
    wrap(g, body, 100, y + 34, W - 140, 27);
  });

  // The claim that is true in every mode, set apart because it is the point.
  const fy = H - 118;
  g.fillStyle = "rgba(255,255,255,.05)";
  g.fillRect(24, fy, W - 48, 74);
  g.fillStyle = accent;
  g.fillRect(24, fy, 5, 74);
  g.fillStyle = "#b8b3cc";
  g.font = "600 20px ui-sans-serif, system-ui, sans-serif";
  wrap(g, page.footer, 46, fy + 30, W - 100, 26);

  g.fillStyle = "rgba(0,0,0,.16)";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
}

/** Word wrap. The bodies are written to fit two lines; this is what guarantees it. */
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  let line = "";
  let ly = y;
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > max && line) {
      g.fillText(line, x, ly);
      line = word;
      ly += lh;
    } else {
      line = next;
    }
  }
  if (line) g.fillText(line, x, ly);
}
