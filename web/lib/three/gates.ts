import * as THREE from "three";
import { STATE } from "./palette";
import { WORLD } from "./stage";
import { extrudeFront, roundedRect } from "./shapes";

/**
 * FLAPPY MODE — the gates and the bird, as solids.
 *
 * A gate is a HALF-PLANE. It starts at its Window's reference level and runs to the
 * edge of the frame, because the venue sells exactly one question per Window — "at
 * or above this line?" — and a bounded pipe with a gap would be a price band the
 * chain cannot settle. The plate therefore has no far edge: a bird on that side is
 * always inside it, which is what makes "hit" and "won" the same statement.
 *
 * That constraint is what the SHAPE has to reconcile. A pipe reads as a pipe because
 * of its mouth, not its length — so each gate is a wide RIM sitting exactly on the
 * reference line, with a SHAFT running away from it to the frame edge. The rim is
 * the thing the eye reads and the thing the rule is about; the shaft just says which
 * side is solid. Semantically it is still a half-plane, and the mouth is at the one
 * height that means anything.
 *
 * The face is a single instant. The outcome depends on the CLOSE, not the path, so
 * the gate is thin in time and sits at the Window's expiry.
 *
 * Coordinates arrive normalised: `u` across the drawable span, `v` bottom-to-top
 * through the price extent. The caller owns the mapping, so this module never needs
 * to know whether it is drawing a live run or a replay of finished Windows.
 */

export type GateVerdict = "won" | "lost" | "void" | "pending" | "skipped";

export interface GateView {
  u0: number;
  u1: number;
  /** The Window's reference level, normalised into the price extent. */
  vRef: number;
  /** `null` for a Window the player skipped — drawn as an empty slot. */
  dir: "UP" | "DOWN" | null;
  verdict: GateVerdict;
  /** Share of the total stake, 0..1. Drives the rim's depth, never its height. */
  weight: number;
}

export interface GatesData {
  gates: GateView[];
  bird: { u: number; v: number }[];
  head: number;
  running: boolean;
  rect: { x0: number; x1: number };
}

export interface Gates {
  group: THREE.Group;
  update: (d: GatesData | null, elapsed: number) => void;
  dispose: () => void;
}

const MAX_GATES = 12;

const TONE: Record<GateVerdict, number> = {
  won: STATE.won,
  lost: STATE.lost,
  void: STATE.skipped,
  pending: STATE.gold,
  skipped: STATE.skipped,
};

/** The rim's height in world units — a mouth, not a wall. */
const RIM_H = 0.34;
const RIM_OVERHANG = 0.16;

interface Slot {
  root: THREE.Group;
  shaft: THREE.Mesh;
  rim: THREE.Mesh;
  shaftMat: THREE.MeshStandardMaterial;
  rimMat: THREE.MeshStandardMaterial;
  /** Wireframe outline for a Window nobody played. */
  empty: THREE.LineSegments;
  emptyMat: THREE.LineBasicMaterial;
}

function makeSlot(): Slot {
  const root = new THREE.Group();

  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.45, metalness: 0.05,
    transparent: true, opacity: 0.72,
  });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shaftMat);

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.3, metalness: 0.12,
    emissive: 0x000000, emissiveIntensity: 0.6,
  });
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), rimMat);

  // Bright: an empty slot has to survive being read against the backdrop.
  const emptyMat = new THREE.LineBasicMaterial({ color: 0x6bffe0, transparent: true, opacity: 0.85 });
  const empty = new THREE.LineSegments(new THREE.BufferGeometry(), emptyMat);

  root.add(shaft, rim, empty);
  return { root, shaft, rim, shaftMat, rimMat, empty, emptyMat };
}

/** A rounded slab whose FRONT face sits on z=0, so depth grows backwards. */
function slab(w: number, h: number, depth: number, radius: number): THREE.BufferGeometry {
  return extrudeFront(roundedRect(w, h, Math.min(radius, Math.min(w, h) / 2.2)), depth, 0.02);
}

export function createGates(): Gates {
  const group = new THREE.Group();
  group.visible = false;

  /**
   * The backdrop.
   *
   * Behind everything, tiled across the span and scrolled slowly while a run is
   * live. It is what turns the board from geometry floating in a void into a place —
   * and the parallax is what sells the bird moving rather than the world sliding.
   *
   * Loaded lazily and never awaited: the scene renders identically without it, so a
   * missing or slow texture costs nothing but the backdrop.
   */
  /**
   * `fog: false` is load-bearing, not a tweak.
   *
   * The chart scene fogs to a near-black GROUND between 16 and 42 units. A backdrop
   * seven units behind the board sits ~22 units from the depth camera, so its middle
   * is already blending to black and everything past 42 units — the outer thirds of
   * a wide plane — renders as solid fog. Enlarging it to "fill the frame" therefore
   * bought darkness, not scenery, which is the symptom that had it scaled up twice.
   */
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x1b2440, toneMapped: false, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  /**
   * Billboarded.
   *
   * A fixed plane is seen in perspective from the orbit camera, which tilts the
   * horizon and makes the ground run diagonally uphill. Facing the viewer keeps it
   * reading as a backdrop instead of a wall the scene is standing on.
   */
  sky.onBeforeRender = (_r, _s, camera) => {
    sky.quaternion.copy(camera.quaternion);
  };
  group.add(sky);

  // A 124 KB JPEG easily outlives a StrictMode double-mount, and the callback would
  // then write to a disposed material and strand the texture.
  let disposed = false;
  new THREE.TextureLoader().load("/flappy/skyline.jpg", (t) => {
    if (disposed) { t.dispose(); return; }
    t.colorSpace = THREE.SRGBColorSpace;
    // Pixel art: never smooth it, and tile it horizontally across the span.
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(4, 1);
    skyMat.map = t;
    skyMat.color.setHex(0xffffff);
    skyMat.needsUpdate = true;
  }, undefined, () => { /* no backdrop; the board still reads */ });

  const slots: Slot[] = [];
  for (let i = 0; i < MAX_GATES; i++) {
    const s = makeSlot();
    s.root.visible = false;
    slots.push(s);
    group.add(s.root);
  }

  /**
   * The reference staircase.
   *
   * One rung per Window at its own level. This is the at-the-money reset — the thing
   * that actually defines the product — and nothing else in the app draws it.
   */
  const rungMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
  const rungs = new THREE.LineSegments(new THREE.BufferGeometry(), rungMat);
  rungs.frustumCulled = false;
  group.add(rungs);

  /** The carriage: which column the next tap lands in. */
  const carriageMat = new THREE.MeshBasicMaterial({
    color: 0xfff1da, transparent: true, opacity: 0.14, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const carriage = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), carriageMat);
  carriage.frustumCulled = false;
  carriage.visible = false;
  group.add(carriage);

  // ── the bird ─────────────────────────────────────────────────────────────
  /**
   * Built from parts rather than a sphere with a glow.
   *
   * A body, two wings that beat, a beak and an eye. The wings are what sell it: a
   * shape that moves reads as alive, and the beat rate rising as it climbs is the
   * one piece of character the scene gets.
   */
  const bird = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffd45e, roughness: 0.42, metalness: 0.05,
    emissive: 0xffb020, emissiveIntensity: 0.35,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 22, 16), bodyMat);
  body.scale.set(1.25, 1, 1);
  bird.add(body);

  const beakMat = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.4 });
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.062, 0.14, 12), beakMat);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.21, -0.01, 0);
  bird.add(beak);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1420, roughness: 0.25 });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), eyeMat);
  eye.position.set(0.11, 0.05, 0.1);
  bird.add(eye);
  const eye2 = eye.clone();
  eye2.position.z = -0.1;
  bird.add(eye2);

  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xfff1da, roughness: 0.5, side: THREE.DoubleSide,
  });
  const wingGeo = slab(0.26, 0.11, 0.02, 0.05);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.set(-0.02, 0.02, 0.1);
  wingR.position.set(-0.02, 0.02, -0.1);
  wingR.rotation.y = Math.PI;
  bird.add(wingL, wingR);
  group.add(bird);

  const trailMat = new THREE.LineBasicMaterial({ color: 0xffd45e, transparent: true, opacity: 0.85 });
  const trail = new THREE.Line(new THREE.BufferGeometry(), trailMat);
  trail.frustumCulled = false;
  group.add(trail);

  let key = "";
  let lastY = 0;
  let lastElapsed = 0;
  /** Wing phase, accumulated. Scaling `elapsed` inside sin() jumps the phase. */
  let wingPhase = 0;

  const update = (d: GatesData | null, elapsed: number) => {
    group.visible = !!d;
    if (!d) return;

    const { x0, x1 } = d.rect;
    const span = x1 - x0;
    const X = (u: number) => x0 + u * span;
    const Y = (v: number) => v * WORLD.spanY;

    // The backdrop sits behind the board and drifts. Its horizontal offset follows
    // the flight, so standing still leaves the world still.
    // Generously oversized and set well back: a backdrop that ends inside the frame
    // is scenery, and the orbit has to be able to swing without exposing its edge.
    /**
     * Placed by its HORIZON, not by its centre.
     *
     * The artwork puts its ground strip about 13% up from the bottom edge, so the
     * plane is positioned to land that line on the board's floor. Scaling it by eye
     * either buries the ground below the frame or leaves a dead band under it —
     * both of which happened before this was derived.
     */
    const skyH = WORLD.spanY * 3.2;
    sky.scale.set(span * 2.1, skyH, 1);
    sky.position.set((x0 + x1) / 2, skyH * 0.37, -7);
    if (skyMat.map) skyMat.map.offset.x = d.head * 0.55 + elapsed * 0.004;

    // Geometry is rebuilt only when the board itself changes, never per frame — a
    // slab per gate is cheap once and wasteful sixty times a second.
    // `x1` and the column bounds are baked into the cached slabs, so they belong in
    // the key. The old per-frame matrix write tracked the rect for free; this does
    // not, and a caller varying the span would render stale widths.
    const k = `${d.gates.length}:${x0.toFixed(2)}:${x1.toFixed(2)}:` +
      d.gates.map((g) =>
        `${g.u0.toFixed(3)}-${g.u1.toFixed(3)}:${g.vRef.toFixed(3)}${g.dir ?? "-"}${g.weight.toFixed(2)}`,
      ).join(",");
    if (k !== key) {
      key = k;
      const rungPts: number[] = [];

      slots.forEach((s, i) => {
        const g = d.gates[i];
        s.root.visible = !!g;
        if (!g) return;

        const xa = X(g.u0);
        const xb = X(g.u1);
        const w = (xb - xa) * 0.86;
        const cx = (xa + xb) / 2;
        const yRef = Y(g.vRef);
        rungPts.push(xa, yRef, 0.04, xb, yRef, 0.04);

        s.shaft.visible = s.rim.visible = !!g.dir;
        s.empty.visible = !g.dir;

        if (!g.dir) {
          // An unplayed Window: an outline where a gate could go, so an empty board
          // still says how many moves there are.
          const t = WORLD.spanY * 0.9;
          const b = WORLD.spanY * 0.1;
          const hw = w / 2;
          s.empty.geometry.dispose();
          const pts = [
            cx - hw, t, 0.03, cx + hw, t, 0.03,
            cx - hw, b, 0.03, cx + hw, b, 0.03,
            cx - hw, t, 0.03, cx - hw, t - 0.18, 0.03,
            cx + hw, t, 0.03, cx + hw, t - 0.18, 0.03,
            cx - hw, b, 0.03, cx - hw, b + 0.18, 0.03,
            cx + hw, b, 0.03, cx + hw, b + 0.18, 0.03,
          ];
          const ge = new THREE.BufferGeometry();
          ge.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
          s.empty.geometry = ge;
          return;
        }

        const up = g.dir === "UP";
        // The shaft runs from the rim to the frame edge — the half-plane made solid.
        const far = up ? WORLD.spanY : 0;
        const near = up ? yRef + RIM_H / 2 : yRef - RIM_H / 2;
        const shaftH = Math.max(Math.abs(far - near), 0.02);
        const depth = 0.22 + g.weight * 0.5;

        s.shaft.geometry.dispose();
        s.shaft.geometry = slab(w, shaftH, depth, 0.06);
        s.shaft.position.set(cx, (far + near) / 2, depth / 2);

        // The mouth, sitting exactly on the reference line and overhanging it.
        s.rim.geometry.dispose();
        s.rim.geometry = slab(w + RIM_OVERHANG, RIM_H, depth + 0.16, 0.07);
        s.rim.position.set(cx, yRef + (up ? RIM_H / 2 : -RIM_H / 2), (depth + 0.16) / 2);
      });

      rungs.geometry.dispose();
      const gr = new THREE.BufferGeometry();
      gr.setAttribute("position", new THREE.Float32BufferAttribute(rungPts, 3));
      rungs.geometry = gr;
    }

    // Colour is per frame: a pending gate breathes, and a verdict can land at any
    // moment without the board's geometry changing.
    slots.forEach((s, i) => {
      const g = d.gates[i];
      if (!g?.dir) return;
      const tone = TONE[g.verdict];
      s.shaftMat.color.setHex(tone);
      s.rimMat.color.setHex(tone);
      s.rimMat.emissive.setHex(tone);
      const settled = g.verdict === "won" || g.verdict === "lost";
      s.rimMat.emissiveIntensity = settled ? 0.55 : 0.2 + 0.18 * Math.sin(elapsed * 3);
      s.shaftMat.opacity = settled ? 0.78 : 0.5;
    });

    const n = d.gates.length;
    carriage.visible = d.running && n > 0;
    if (carriage.visible) {
      const col = Math.min(n - 1, Math.floor(d.head * n));
      const g = d.gates[col];
      carriage.scale.set((g.u1 - g.u0) * span, WORLD.spanY, 1);
      carriage.position.set(X((g.u0 + g.u1) / 2), WORLD.spanY / 2, 0.01);
      carriageMat.opacity = 0.11 + 0.07 * Math.sin(elapsed * 8);
    }

    // ── the flight ─────────────────────────────────────────────────────────
    const dt = Math.min(Math.max(elapsed - lastElapsed, 0), 0.1);
    lastElapsed = elapsed;

    const path = d.bird;
    bird.visible = path.length > 1 && d.running;
    trail.visible = path.length > 1;
    trailMat.opacity = d.running ? 0.85 : 0.26;
    if (path.length > 1) {
      /**
       * The flight is INTERPOLATED between Windows, not snapped to them.
       *
       * `birdPath` gives one point per Window — eight for a six-Leg run — so an
       * integer index advances about seven times across six seconds. Reading
       * position, and therefore velocity, off that index left the bird motionless
       * for hundreds of frames and teleporting for one. That is a twitch, not flight.
       */
      const last = path.length - 1;
      const t = d.running ? Math.min(d.head, 1) * last : last;
      const i = Math.min(Math.floor(t), last);
      const f = t - i;
      const j = Math.min(i + 1, last);
      const hx = THREE.MathUtils.lerp(X(path[i].u), X(path[j].u), f);
      const hy = THREE.MathUtils.lerp(Y(path[i].v), Y(path[j].v), f);

      const pts: THREE.Vector3[] = [];
      for (let k2 = 0; k2 <= i; k2++) pts.push(new THREE.Vector3(X(path[k2].u), Y(path[k2].v), 0.4));
      pts.push(new THREE.Vector3(hx, hy, 0.4));
      trail.geometry.dispose();
      trail.geometry = new THREE.BufferGeometry().setFromPoints(pts);

      bird.position.set(hx, hy, 0.5);

      // Vertical speed in world units per second, from the interpolated position.
      const climb = dt > 0 ? (hy - lastY) / dt : 0;
      lastY = hy;
      // Eased, so a sampling hiccup cannot snap the bird flat for a single frame.
      const bank = THREE.MathUtils.clamp(climb * 0.5, -0.55, 0.55);
      bird.rotation.z += (bank - bird.rotation.z) * Math.min(1, dt * 9);

      // Phase is ACCUMULATED. Scaling `elapsed` — unbounded seconds since load —
      // inside sin() moves the argument by hundreds of radians at once, so the wings
      // jump to an arbitrary angle instead of beating faster.
      wingPhase += dt * (11 + Math.max(0, climb) * 4);
      const beat = Math.sin(wingPhase);
      wingL.rotation.x = -0.5 + beat * 0.85;
      wingR.rotation.x = 0.5 - beat * 0.85;
    }
  };

  return {
    group,
    update,
    dispose: () => {
      disposed = true;
      for (const s of slots) {
        s.shaft.geometry.dispose();
        s.rim.geometry.dispose();
        s.empty.geometry.dispose();
        s.shaftMat.dispose();
        s.rimMat.dispose();
        s.emptyMat.dispose();
      }
      sky.geometry.dispose();
      skyMat.map?.dispose();
      skyMat.dispose();
      rungs.geometry.dispose();
      rungMat.dispose();
      carriage.geometry.dispose();
      carriageMat.dispose();
      bird.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      bodyMat.dispose();
      beakMat.dispose();
      eyeMat.dispose();
      wingMat.dispose();
      trail.geometry.dispose();
      trailMat.dispose();
    },
  };
}
