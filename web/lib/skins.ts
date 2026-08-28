/**
 * Device skins.
 *
 * A skin is a SOLID moulded body plus coloured parts — not a gradient. That is what
 * makes the shell read as injection-moulded plastic under one key light rather than
 * as a painted surface, and it is why the previous rainbow bezel fought every other
 * element on screen.
 *
 * ONE skin drives everything: the shell, the screen bezel, the wheel, the buttons,
 * the extruded mark, and the four chart lanes. Nothing on the device may introduce a
 * colour from outside its skin.
 */
export interface Skin {
  key: string;
  name: string;
  /** The moulded body. Every other shell tone is derived from it by the renderer. */
  shell: string;
  /** The recessed frame around a screen and the wells the buttons sit in. */
  recess: string;
  /** Click-wheel face and its centre select. */
  wheel: string;
  centre: string;
  /** The two square action keys. A distinct part from the pills, as on the hardware. */
  action: string;
  /** The pills and the small mode cap. */
  cap: string;
  /** Silkscreen ink: the mark, the captions. */
  ink: string;
  /**
   * The four chart lanes, nearest first. Decorative — they separate resolutions and
   * carry no meaning, so they must never collide with the UP/DOWN state colours.
   */
  lanes: [number, number, number, number];
  /** Page ground behind the device. Derived from the shell, darkened. */
  ground: string;
}

export const SKINS: Skin[] = [
  {
    key: "bone", name: "Bone",
    shell: "#e9dbbf", recess: "#c4b797", wheel: "#f2ede0", centre: "#d63a2e",
    action: "#3568c9", cap: "#c1c1c1", ink: "#7c7870",
    lanes: [0xd63a2e, 0xf2c044, 0x3568c9, 0x8a8d93], ground: "#171512",
  },
  {
    key: "graphite", name: "Graphite",
    shell: "#16171b", recess: "#0a0b0e", wheel: "#2a2d34", centre: "#f2c044",
    action: "#2a2d34", cap: "#2a2d34", ink: "#9296a0",
    lanes: [0xf2c044, 0xe6b740, 0x6cb2ff, 0x9296a0], ground: "#0a0a0c",
  },
  {
    key: "frost", name: "Frost",
    shell: "#d7dade", recess: "#9aa0a8", wheel: "#eef0f3", centre: "#e5322b",
    action: "#171a20", cap: "#171a20", ink: "#5c626c",
    lanes: [0xe5322b, 0x2ec5c9, 0x3568c9, 0x8a8d93], ground: "#111317",
  },
  {
    key: "ember", name: "Ember",
    shell: "#b8bcc2", recess: "#8b8f96", wheel: "#e8ede0", centre: "#e05a20",
    action: "#555a60", cap: "#555a60", ink: "#7a3d12",
    lanes: [0xe05a20, 0xff9d4d, 0x5fbcee, 0x7a7f86], ground: "#14100c",
  },
  {
    key: "sage", name: "Sage",
    shell: "#c2e9d3", recess: "#95bda6", wheel: "#e6f5ec", centre: "#8587ef",
    action: "#5fbcee", cap: "#5fbcee", ink: "#4a7060",
    lanes: [0x8587ef, 0x5fbcee, 0x2fbf62, 0x8bbaa2], ground: "#0d1712",
  },
  {
    key: "neon", name: "Neon",
    shell: "#cf42cf", recess: "#8e2a8e", wheel: "#f0e6f5", centre: "#00e5cc",
    action: "#4c2399", cap: "#4c2399", ink: "#f4e9f6",
    lanes: [0x00e5cc, 0xefd53f, 0x9e75f2, 0xff7ba9], ground: "#170a17",
  },
  {
    key: "bullion", name: "Bullion",
    shell: "#c9a227", recess: "#8e711a", wheel: "#f0cf5c", centre: "#221a0d",
    action: "#221a0d", cap: "#241c0e", ink: "#4a3708",
    lanes: [0xf6e185, 0xf0cf5c, 0xc9a227, 0x8e711a], ground: "#120e03",
  },
];

export const DEFAULT_SKIN = "frost";
export const skinByKey = (k: string): Skin => SKINS.find((s) => s.key === k) ?? SKINS[0];

/** Shade a hex colour toward black (t<0) or white (t>0). Used for moulded edges. */
export function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const to = t < 0 ? 0 : 255;
  const k = Math.abs(t);
  const ch = (sh: number) => {
    const c = (n >> sh) & 0xff;
    return Math.round(c + (to - c) * k);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}
