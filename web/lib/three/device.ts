import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { circleHole, extrudeFront, knurlBump, pocketWall, roundedHole, roundedRect } from "./shapes";
import { iconTexture, type IconName } from "./icons";
import { shade, type Skin } from "../skins";

/**
 * The KURVV handheld — landscape, two screens, one click wheel.
 *
 * Layout, left to right:
 *   MAIN SCREEN   the 3D chart, and the configuration surface when swapped
 *   RIGHT COLUMN  the mark, the DMG panel, a connect key, the click wheel with four
 *                 quadrant actions and a centre select, a knurled bet-price wheel on
 *                 the outer edge with its stake readout, and two quick-action caps
 *
 * Built as a real object: the front face of every extrusion sits on z = 0, every
 * recess has a stitched wall rather than a painted shadow, the seam is a tube around
 * the outline, and the grip ridges are capsules on the side walls — which only exist
 * because the body has side walls at all.
 */

export type DeviceId =
  | "authorise" | "draw" | "board" | "cancel" | "new" | "swap" | "mode";

const BODY = { w: 14.4, h: 8.4, corner: 0.6, depth: 0.62, bevel: 0.08 };
const BACK = { depth: 1.0 };
const SEAM_Z = -0.72;

/**
 * ONE margin, used on every edge.
 *
 * Both screens start at the same distance from the top and keep the same gap from
 * the shell on every side, so the face reads as laid out rather than assembled. Every
 * position below is derived from MARGIN and GUTTER — no free-floating coordinates,
 * because those are what drift out of alignment on the next edit.
 */
const MARGIN = 0.55;
const GUTTER = 0.5;
const TOP = BODY.h / 2 - MARGIN;
const BOTTOM = -BODY.h / 2 + MARGIN;
const LEFT = -BODY.w / 2 + MARGIN;
const RIGHT = BODY.w / 2 - MARGIN;

/** The control column takes a fixed width off the right; the chart takes the rest. */
const COL_W = 5.0;
const MAIN_W = BODY.w - MARGIN * 2 - GUTTER - COL_W;
const COL_L = RIGHT - COL_W;

const MAIN = { x: LEFT + MAIN_W / 2, y: (TOP + BOTTOM) / 2, w: MAIN_W, h: TOP - BOTTOM, r: 0.3, pad: 0.18 };
/** The control panel: same top edge as the chart, same margin on its own three sides. */
const GB_H_ = 2.95;
const GB = { x: COL_L + COL_W / 2, y: TOP - GB_H_ / 2, w: COL_W, h: GB_H_, r: 0.16, pad: 0.15 };

/** Everything below the panel is the control area. */
const CTRL_TOP = TOP - GB_H_ - GUTTER;

/** Four sectors that press independently, and a centre select. */
const WHEEL = { x: COL_L + 1.85, y: (CTRL_TOP + BOTTOM) / 2, outer: 1.75, inner: 0.66, pad: 0.13 };
/** The scroll sits at the top of the right stack, where a thumb rests. */
const BET = {
  x: RIGHT - 0.5, y: CTRL_TOP - 1.02, radius: 1.0, height: 0.62, edgeCurve: 0.09,
  ridgeWidth: 120, grooveWidth: 50, ridgeLength: 0.825, repeat: 22,
  bumpDepth: 0.2, bumpScale: 6, pad: 0.14,
};
/** The two quick actions, STACKED under the scroll on the same centre line. */
const QUICK: { id: DeviceId; y: number; icon: IconName }[] = [
  { id: "swap", y: BET.y - BET.radius - 0.62, icon: "swap" },
  { id: "mode", y: BET.y - BET.radius - 1.62, icon: "mode" },
];
const QUICK_X = BET.x;
const QUICK_R = 0.38;

/** Which action sits where on the wheel. */
const QUADRANTS: { id: DeviceId; icon: IconName; ax: number; ay: number }[] = [
  { id: "new", icon: "plan", ax: 0, ay: 1 },
  { id: "board", icon: "trophy", ax: 1, ay: 0 },
  { id: "draw", icon: "curve", ax: 0, ay: -1 },
  { id: "cancel", icon: "back", ax: -1, ay: 0 },
];

export interface DevicePart { id: DeviceId; mesh: THREE.Mesh; baseZ: number; pressedZ: number }

export interface Device {
  root: THREE.Group;
  parts: DevicePart[];
  targets: THREE.Object3D[];
  /** The click-wheel annulus; hit anywhere and the quadrant decides the action. */
  ring: THREE.Group;
  betWheel: THREE.Mesh;
  /** The chart surface. Raycast against it to turn a pointer into a screen UV. */
  mainScreen: THREE.Mesh;
  /** Swap what the big screen shows: the chart target, or the settings panel. */
  setMainTexture: (tex: THREE.Texture) => void;
  /** The DMG texture is only re-uploaded when its canvas actually changed. */
  markScreenDirty: () => void;
  /** Recolour every part in place. Rebuilding the scene for a skin drops a frame
   *  budget and resets the camera; the reference mutates materials instead. */
  applySkin: (next: Skin) => void;
  setPressed: (id: DeviceId | null) => void;
  setEnabled: (id: DeviceId, on: boolean) => void;
  setActive: (id: DeviceId, on: boolean) => void;
  setGlyph: (id: DeviceId, icon: IconName) => void;
  spinBet: (delta: number) => void;
  update: (dt: number, elapsed: number) => void;
  dispose: () => void;
}

export function createDevice(initialSkin: Skin, mainTexture: THREE.Texture, gbCanvas: HTMLCanvasElement): Device {
  // Mutable, so `applySkin` can retint every part without rebuilding the scene.
  let skin = initialSkin;
  const root = new THREE.Group();
  const bin: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T): T => { bin.push(x); return x; };

  const M = {
    body: keep(new THREE.MeshStandardMaterial({ color: skin.shell, roughness: 0.62, metalness: 0.02 })),
    back: keep(new THREE.MeshStandardMaterial({ color: shade(skin.shell, -0.12), roughness: 0.72, metalness: 0.02 })),
    recess: keep(new THREE.MeshStandardMaterial({ color: skin.recess, roughness: 0.82, metalness: 0.02 })),
    seam: keep(new THREE.MeshStandardMaterial({ color: shade(skin.shell, -0.28), roughness: 0.55, metalness: 0.1 })),
    metal: keep(new THREE.MeshStandardMaterial({ color: 0xb9bec7, roughness: 0.34, metalness: 0.9 })),
  };

  // ── body ─────────────────────────────────────────────────────────────────
  const face = roundedRect(BODY.w, BODY.h, BODY.corner);
  face.holes.push(roundedHole(MAIN.x, MAIN.y, MAIN.w, MAIN.h, MAIN.r));
  face.holes.push(roundedHole(GB.x, GB.y, GB.w, GB.h, GB.r));
  face.holes.push(circleHole(WHEEL.x, WHEEL.y, WHEEL.outer + WHEEL.pad));
  face.holes.push(roundedHole(BET.x, BET.y, BET.height + BET.pad * 2, BET.radius * 1.5, 0.12));
  for (const q of QUICK) face.holes.push(circleHole(QUICK_X, q.y, QUICK_R + 0.09));
  const bodyGeo = keep(extrudeFront(face, BODY.depth, BODY.bevel));
  const body = new THREE.Mesh(bodyGeo, M.body);
  body.castShadow = body.receiveShadow = true;
  root.add(body);

  const backGeo = keep(extrudeFront(roundedRect(BODY.w, BODY.h, BODY.corner), BACK.depth, 0.06));
  const back = new THREE.Mesh(backGeo, M.back);
  back.position.z = -BODY.depth + 0.02;
  back.castShadow = back.receiveShadow = true;
  root.add(back);

  // The seam: a tube around the outline, not a drawn line.
  const outline = roundedRect(BODY.w + 0.05, BODY.h + 0.05, BODY.corner + 0.02)
    .getPoints(48).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const seam = new THREE.Mesh(keep(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(outline, true, "catmullrom", 0), 280, 0.032, 8, true,
  )), M.seam);
  seam.position.z = SEAM_Z;
  root.add(seam);

  // Grip ridges on the side walls.
  const ridgeGeo = keep(new THREE.CapsuleGeometry(0.03, 1.5, 4, 12));
  const edgeX = (BODY.w + 0.16) / 2 - 0.03;
  for (const sx of [-1, 1]) {
    for (const z of [-0.82, -1.04, -1.26]) {
      const r = new THREE.Mesh(ridgeGeo, M.recess);
      r.position.set(sx * edgeX, 0, z);
      root.add(r);
    }
  }

  /** Floor + stitched wall. The wall is what makes a recess read as depth. */
  const addPocket = (x: number, y: number, w: number, h: number, r: number, pad: number, depth: number) => {
    const floor = new THREE.Mesh(keep(new THREE.ShapeGeometry(roundedRect(w, h, r), 48)), M.recess);
    floor.position.set(x, y, -depth);
    floor.receiveShadow = true;
    const wall = new THREE.Mesh(keep(pocketWall(w, h, r, pad)), M.recess);
    wall.position.set(x, y, 0);
    wall.receiveShadow = true;
    root.add(floor, wall);
  };

  /** A screen: a deep well with a lit panel at its floor. */
  const addScreen = (tex: THREE.Texture, x: number, y: number, w: number, h: number, r: number, pad: number) => {
    addPocket(x, y, w, h, r, pad, 0.22);
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(w - 0.22, h - 0.22)), mat);
    glass.position.set(x, y, -0.19);
    root.add(glass);
    return glass;
  };

  // The chart renders into a target and arrives here as a texture, so the whole
  // device is ONE WebGL context — and the screen is a real surface a ray can hit.
  const mainScreen = addScreen(mainTexture, MAIN.x, MAIN.y, MAIN.w, MAIN.h, MAIN.r, MAIN.pad);
  mainScreen.userData.touch = true;
  const gbTex = keep(new THREE.CanvasTexture(gbCanvas));
  gbTex.colorSpace = THREE.SRGBColorSpace;
  gbTex.magFilter = THREE.NearestFilter;              // hard pixels on the DMG
  addScreen(gbTex, GB.x, GB.y, GB.w, GB.h, GB.r, GB.pad);

  // ── caps ─────────────────────────────────────────────────────────────────
  const parts: DevicePart[] = [];
  const mats = new Map<DeviceId, THREE.MeshStandardMaterial>();
  const glyphs = new Map<DeviceId, THREE.MeshBasicMaterial>();
  /** Which surface each glyph sits on, so its ink survives a skin change. */
  const glyphOn = new Map<DeviceId, "wheel" | "centre" | "cap">();

  /**
   * Ink that survives its cap.
   *
   * A white glyph on a near-white wheel is invisible, and a dark one on a black cap
   * is equally useless. Pick the ink from the cap's own luminance rather than fixing
   * it — skins change every cap colour underneath these.
   */
  const inkOn = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return lum > 0.55 ? 0x2a2e36 : 0xf4f6f8;
  };

  const surfaceOf = (k: "wheel" | "centre" | "cap") =>
    k === "wheel" ? skin.wheel : k === "centre" ? skin.centre : shade(skin.cap, 0.06);

  const addGlyph = (id: DeviceId, icon: IconName, size: number, x: number, y: number, z: number, parent: THREE.Object3D, on: "wheel" | "centre" | "cap") => {
    glyphOn.set(id, on);
    const mat = keep(new THREE.MeshBasicMaterial({
      map: keep(iconTexture(icon)), color: new THREE.Color(inkOn(surfaceOf(on))),
      transparent: true, depthWrite: false, toneMapped: false,
    }));
    glyphs.set(id, mat);
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(size, size)), mat);
    m.position.set(x, y, z);
    parent.add(m);
  };

  const addKey = (id: DeviceId, x: number, y: number, geo: THREE.BufferGeometry, colour: string, baseZ: number) => {
    const mat = keep(new THREE.MeshStandardMaterial({
      color: colour, roughness: 0.5, metalness: 0,
      emissive: new THREE.Color(colour), emissiveIntensity: 0,
    }));
    mats.set(id, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, baseZ);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.deviceId = id;
    root.add(mesh);
    parts.push({ id, mesh, baseZ, pressedZ: baseZ - 0.12 });
    return mesh;
  };

  // ── the click wheel ──────────────────────────────────────────────────────
  addPocket(WHEEL.x, WHEEL.y, WHEEL.outer * 2, WHEEL.outer * 2, WHEEL.outer, WHEEL.pad, 0.17);

  /**
   * One sector per direction, not one annulus.
   *
   * Pressing a direction must sink only THAT side — a single ring mesh can only move
   * as a whole, which reads as the entire surface dropping and tells the user nothing
   * about which way they pressed.
   */
  const ringMats: THREE.MeshStandardMaterial[] = [];
  const GAP = 0.03;
  const sectorShape = (a0: number, a1: number) => {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, WHEEL.outer, a0 + GAP, a1 - GAP, false);
    sh.absarc(0, 0, WHEEL.inner, a1 - GAP, a0 + GAP, true);
    sh.closePath();
    return sh;
  };
  const rad = (WHEEL.outer + WHEEL.inner) / 2;
  const ring = new THREE.Group();
  ring.position.set(WHEEL.x, WHEEL.y, 0);
  root.add(ring);

  for (const q of QUADRANTS) {
    const mid = Math.atan2(q.ay, q.ax);
    const geo = keep(extrudeFront(sectorShape(mid - Math.PI / 4, mid + Math.PI / 4), 0.22, 0.04));
    const mat = keep(new THREE.MeshStandardMaterial({
      color: skin.wheel, roughness: 0.44, metalness: 0.05,
      emissive: new THREE.Color(skin.wheel), emissiveIntensity: 0,
    }));
    mats.set(q.id, mat);
    ringMats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0, 0.11);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.deviceId = q.id;
    mesh.userData.wheel = true;
    ring.add(mesh);
    parts.push({ id: q.id, mesh, baseZ: 0.11, pressedZ: 0.045 });
    addGlyph(q.id, q.icon, 0.5, q.ax * rad, q.ay * rad, 0.13, mesh, "wheel");
  }

  const centreGeo = keep(new THREE.CylinderGeometry(WHEEL.inner - 0.05, WHEEL.inner - 0.09, 0.24, 44));
  centreGeo.rotateX(Math.PI / 2);
  const centre = addKey("authorise", WHEEL.x, WHEEL.y, centreGeo, skin.centre, 0.15);
  addGlyph("authorise", "bolt", 0.54, 0, 0, 0.13, centre, "centre");

  // ── quick actions ────────────────────────────────────────────────────────
  const quickGeo = keep(new THREE.CylinderGeometry(QUICK_R, QUICK_R - 0.025, 0.2, 36));
  quickGeo.rotateX(Math.PI / 2);
  for (const q of QUICK) {
    addPocket(QUICK_X, q.y, QUICK_R * 2 + 0.06, QUICK_R * 2 + 0.06, QUICK_R + 0.03, 0.06, 0.12);
    const mesh = addKey(q.id, QUICK_X, q.y, quickGeo, shade(skin.cap, 0.06), 0.12);
    addGlyph(q.id, q.icon, QUICK_R * 1.35, 0, 0, 0.11, mesh, "cap");
  }

  // ── the bet-price scroll ─────────────────────────────────────────────────
  // A lathe laid on its side and sunk in a slot, so only an arc is proud and a
  // vertical drag rolls it. The knurl is a bump map; the silhouette stays clean.
  addPocket(BET.x, BET.y, BET.height + BET.pad * 2, BET.radius * 1.5, 0.12, 0.09, 0.42);
  const profile: THREE.Vector2[] = [];
  {
    const { radius: R, height: H, edgeCurve: E } = BET;
    profile.push(new THREE.Vector2(0, -H / 2));
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * (Math.PI / 2);
      profile.push(new THREE.Vector2(R - E + E * Math.cos(a), -H / 2 + E + E * Math.sin(a)));
    }
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 2);
      profile.push(new THREE.Vector2(R - E + E * Math.cos(a), H / 2 - E + E * Math.sin(a)));
    }
    profile.push(new THREE.Vector2(0, H / 2));
  }
  const betGeo = keep(new THREE.LatheGeometry(profile, 64));
  betGeo.rotateZ(Math.PI / 2);                     // axis along X: a vertical drag rolls it
  const betMat = keep(new THREE.MeshStandardMaterial({
    color: skin.wheel, roughness: 0.88, metalness: 0.06,
    bumpMap: keep(knurlBump({
      ridgeWidth: BET.ridgeWidth, grooveWidth: BET.grooveWidth,
      depth: BET.bumpDepth, ridgeLength: BET.ridgeLength, repeat: BET.repeat,
    })),
    bumpScale: BET.bumpScale,
  }));
  const betWheel = new THREE.Mesh(betGeo, betMat);
  betWheel.position.set(BET.x, BET.y, -BET.radius + 0.24);
  betWheel.castShadow = true;
  betWheel.userData.deviceId = "bet";
  root.add(betWheel);

  // ── the mark, embossed into the backplate ────────────────────────────────
  const markMat = keep(new THREE.MeshStandardMaterial({
    color: shade(skin.shell, -0.18), roughness: 0.5, metalness: 0.06, side: THREE.DoubleSide,
  }));
  new SVGLoader().load("/kurvv.svg", (data) => {
    const g = new THREE.Group();
    for (const path of data.paths) {
      for (const sh of SVGLoader.createShapes(path)) {
        const geo = new THREE.ExtrudeGeometry(sh, {
          depth: 26, bevelEnabled: true, bevelThickness: 6, bevelSize: 6, bevelSegments: 3, curveSegments: 12,
        });
        bin.push(geo);
        g.add(new THREE.Mesh(geo, markMat));
      }
    }
    const box = new THREE.Box3().setFromObject(g);
    const size = new THREE.Vector3();
    const mid = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(mid);
    const k = 5.2 / size.x;
    // -Y undoes SVG's downward axis; the holder is turned to face out the back.
    g.scale.set(k, -k, k);
    g.position.set(-mid.x * k, mid.y * k, 0);
    const holder = new THREE.Group();
    holder.add(g);
    holder.rotation.y = Math.PI;
    holder.position.set(0, 0, -BODY.depth - BACK.depth + 0.02);
    root.add(holder);
    backMark = markMat;
  });
  let backMark: THREE.MeshStandardMaterial | null = markMat;

  // ── corner screws ────────────────────────────────────────────────────────
  const headGeo = keep(new THREE.CylinderGeometry(0.105, 0.125, 0.05, 22));
  headGeo.rotateX(Math.PI / 2);
  const slotGeo = keep(new THREE.BoxGeometry(0.16, 0.034, 0.02));
  const wellGeo = keep(new THREE.CircleGeometry(0.17, 24));
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(wellGeo, M.recess));
    const head = new THREE.Mesh(headGeo, M.metal);
    head.position.z = -0.026;
    head.castShadow = true;
    const a = new THREE.Mesh(slotGeo, M.recess);
    a.position.z = -0.05;
    const b = new THREE.Mesh(slotGeo, M.recess);
    b.position.z = -0.05;
    b.rotation.z = Math.PI / 2;
    g.add(head, a, b);
    g.position.set(sx * (BODY.w / 2 - 0.4), sy * (BODY.h / 2 - 0.4), -BODY.depth - BACK.depth + 0.06);
    g.rotation.y = Math.PI;
    root.add(g);
  }

  let pressed: DeviceId | null = null;
  const enabled = new Map<DeviceId, boolean>();
  const active = new Map<DeviceId, boolean>();
  const baseColour = (id: DeviceId) =>
    id === "authorise" ? skin.centre
    : id === "swap" || id === "mode" ? shade(skin.cap, 0.06)
    : skin.wheel;   // the four ring sectors

  return {
    root, parts, ring, betWheel, mainScreen,
    setMainTexture: (tex) => {
      (mainScreen.material as THREE.MeshBasicMaterial).map = tex;
      (mainScreen.material as THREE.MeshBasicMaterial).needsUpdate = true;
    },
    markScreenDirty: () => { gbTex.needsUpdate = true; },
    applySkin: (next) => {
      skin = next;
      M.body.color.set(skin.shell);
      M.back.color.set(shade(skin.shell, -0.12));
      M.recess.color.set(skin.recess);
      M.seam.color.set(shade(skin.shell, -0.28));
      for (const m of ringMats) { m.color.set(skin.wheel); m.emissive.set(skin.wheel); }
      backMark?.color.set(shade(skin.shell, -0.18));
      betMat.color.set(skin.wheel);
      // Ink is derived, not stored: a skin can flip a cap from near-white to black.
      for (const [id, mat] of glyphs) mat.color.set(inkOn(surfaceOf(glyphOn.get(id) ?? "cap")));
    },
    targets: [ring, betWheel, ...parts.map((p) => p.mesh)],
    setPressed: (id) => { pressed = id; },
    setEnabled: (id, on) => { enabled.set(id, on); },
    setActive: (id, on) => { active.set(id, on); },
    setGlyph: (id, icon) => {
      const mat = glyphs.get(id);
      if (!mat) return;
      mat.map?.dispose();
      const t = iconTexture(icon);
      bin.push(t);
      mat.map = t;
      mat.needsUpdate = true;
    },
    spinBet: (d) => { betWheel.rotation.x += d; },
    update: (dt, elapsed) => {
      const k = Math.min(1, dt * 20);
      for (const p of parts) {
        const want = pressed === p.id ? p.pressedZ : p.baseZ;
        p.mesh.position.z += (want - p.mesh.position.z) * k;
        const mat = mats.get(p.id);
        if (!mat) continue;
        const live = enabled.get(p.id) !== false;
        // A latched or armed control breathes, so the next move is obvious.
        mat.emissiveIntensity = !live ? 0
          : active.get(p.id) || p.id === "authorise" ? 0.16 + 0.12 * Math.sin(elapsed * 2.6)
          : 0;
        // Disabled DIMS a cap; it never repaints it with another part's tone.
        mat.color.set(live ? baseColour(p.id) : shade(baseColour(p.id), -0.42));
      }
      for (const [id, mat] of glyphs) mat.opacity = enabled.get(id) === false ? 0.3 : 1;
    },
    dispose: () => { for (const d of bin) d.dispose(); },
  };
}
