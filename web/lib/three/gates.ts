import * as THREE from "three";
import { STATE } from "./palette";
import { WORLD } from "./stage";

/**
 * FLAPPY MODE — the gates and the bird.
 *
 * A gate is a HALF-PLANE. It starts at its Window's reference level and runs to the
 * edge of the frame, because the venue sells exactly one question per Window — "at
 * or above this line?" — and a bounded pipe with a gap would be a price band the
 * chain cannot settle. The plate therefore has no far edge: a bird on that side is
 * always inside it, which is what makes "hit" and "won" the same statement.
 *
 * Its face is a single instant. The outcome depends on the CLOSE, not the path, so
 * the plate is thin in time and sits at the Window's expiry. Anything to its left is
 * approach, not contact — a plate the bird could be "inside" mid-Window could show a
 * hit and then resolve the other way.
 *
 * Coordinates arrive normalised: `u` across the drawable span, `v` bottom-to-top
 * through the price extent. The caller owns the mapping, so this module never needs
 * to know whether it is drawing a live run or a replay of finished Windows.
 */

export type GateVerdict = "won" | "lost" | "void" | "pending" | "skipped";

export interface GateView {
  /** Column span across the drawable region, both 0..1. */
  u0: number;
  u1: number;
  /** The Window's reference level, normalised into the price extent. */
  vRef: number;
  /** `null` for a Window the player skipped — drawn as an empty frame. */
  dir: "UP" | "DOWN" | null;
  verdict: GateVerdict;
  /** Share of the total stake, 0..1. Drives depth and glow, never height. */
  weight: number;
}

export interface GatesData {
  gates: GateView[];
  /** The bird's flight, normalised. Empty hides it. */
  bird: { u: number; v: number }[];
  /** How far along the flight the bird currently is, 0..1. */
  head: number;
  /** World-space rect the normalised coordinates map into. */
  rect: { x0: number; x1: number };
}

export interface Gates {
  group: THREE.Group;
  update: (d: GatesData | null, elapsed: number) => void;
  dispose: () => void;
}

const MAX_GATES = 12;

/** Muted until the chain speaks. A pending gate must not look like a won one. */
const TONE: Record<GateVerdict, number> = {
  won: STATE.won,
  lost: STATE.lost,
  void: STATE.skipped,
  pending: STATE.gold,
  skipped: STATE.skipped,
};

export function createGates(): Gates {
  const group = new THREE.Group();
  group.visible = false;

  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();

  // ── the plates ───────────────────────────────────────────────────────────
  const plateGeo = new THREE.PlaneGeometry(1, 1);
  const plateMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const plates = new THREE.InstancedMesh(plateGeo, plateMat, MAX_GATES);
  plates.frustumCulled = false;
  plates.count = 0;
  plates.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GATES * 3), 3);
  group.add(plates);

  /** The contact face: the one instant the verdict is read at. */
  const faceGeo = new THREE.PlaneGeometry(1, 1);
  const faceMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.95, side: THREE.DoubleSide, toneMapped: false,
  });
  const faces = new THREE.InstancedMesh(faceGeo, faceMat, MAX_GATES);
  faces.frustumCulled = false;
  faces.count = 0;
  faces.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GATES * 3), 3);
  group.add(faces);

  /**
   * The reference staircase.
   *
   * One short rung per Window at its own level. This is the at-the-money reset — the
   * thing that actually defines the product — and nothing else in the app draws it.
   */
  const rungMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const rungs = new THREE.LineSegments(new THREE.BufferGeometry(), rungMat);
  rungs.frustumCulled = false;
  group.add(rungs);

  // ── the bird ─────────────────────────────────────────────────────────────
  const birdMat = new THREE.MeshStandardMaterial({
    color: 0xfff1da, emissive: 0xfff1da, emissiveIntensity: 2.4, roughness: 0.3, toneMapped: false,
  });
  const bird = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), birdMat);
  bird.frustumCulled = false;
  group.add(bird);

  // A halo, so the bird reads against a plate it is sitting inside.
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xfff1da, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.4, 28), haloMat);
  halo.frustumCulled = false;
  group.add(halo);

  const trailMat = new THREE.LineBasicMaterial({ color: 0xfff1da, transparent: true, opacity: 0.85 });
  const trail = new THREE.Line(new THREE.BufferGeometry(), trailMat);
  trail.frustumCulled = false;
  group.add(trail);

  let rungKey = "";

  const update = (d: GatesData | null, elapsed: number) => {
    group.visible = !!d;
    if (!d) { plates.count = 0; faces.count = 0; return; }

    const { x0, x1 } = d.rect;
    const span = x1 - x0;
    const X = (u: number) => x0 + u * span;
    const Y = (v: number) => v * WORLD.spanY;

    let n = 0;
    const rungPts: number[] = [];
    for (const g of d.gates) {
      if (n >= MAX_GATES) break;
      const yRef = Y(g.vRef);
      rungPts.push(X(g.u0), yRef, 0.03, X(g.u1), yRef, 0.03);

      if (!g.dir) continue; // a skipped Window is its rung and nothing else

      // The half-plane: from the reference line to the edge of the frame.
      const top = g.dir === "UP" ? WORLD.spanY : 0;
      const h = Math.abs(top - yRef);
      const yMid = (top + yRef) / 2;
      const w = (g.u1 - g.u0) * span;
      const depth = 0.4 + g.weight * 2.2;

      m4.makeScale(Math.max(w * 0.9, 1e-4), Math.max(h, 1e-4), 1);
      m4.setPosition(X((g.u0 + g.u1) / 2), yMid, 0.02);
      plates.setMatrixAt(n, m4);

      col.setHex(TONE[g.verdict]);
      if (g.verdict === "pending") col.multiplyScalar(0.6 + 0.25 * Math.sin(elapsed * 3));
      plates.setColorAt(n, col);

      // The contact face sits at the column's trailing edge — the Window's expiry.
      m4.makeScale(0.045, Math.max(h, 1e-4), depth * 0.14);
      m4.setPosition(X(g.u1), yMid, 0.02);
      faces.setMatrixAt(n, m4);
      faces.setColorAt(n, col);
      n++;
    }
    plates.count = n;
    faces.count = n;
    plates.instanceMatrix.needsUpdate = true;
    faces.instanceMatrix.needsUpdate = true;
    if (plates.instanceColor) plates.instanceColor.needsUpdate = true;
    if (faces.instanceColor) faces.instanceColor.needsUpdate = true;

    const rk = `${d.gates.length}:${x0.toFixed(2)}:${d.gates.map((g) => g.vRef.toFixed(3)).join(",")}`;
    if (rk !== rungKey) {
      rungKey = rk;
      rungs.geometry.dispose();
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute("position", new THREE.Float32BufferAttribute(rungPts, 3));
      rungs.geometry = g2;
    }

    // ── the flight ─────────────────────────────────────────────────────────
    const path = d.bird;
    bird.visible = trail.visible = halo.visible = path.length > 1;
    if (path.length > 1) {
      const flown = Math.max(1, Math.floor(d.head * (path.length - 1)));
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= flown; i++) pts.push(new THREE.Vector3(X(path[i].u), Y(path[i].v), 0.05));
      trail.geometry.dispose();
      trail.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      const head = pts[pts.length - 1];
      bird.position.copy(head);
      bird.position.z = 0.14;
      halo.position.copy(bird.position);
      halo.scale.setScalar(1 + 0.18 * Math.sin(elapsed * 4));
      haloMat.opacity = 0.4 + 0.2 * Math.sin(elapsed * 4);
    }
  };

  return {
    group,
    update,
    dispose: () => {
      plateGeo.dispose();
      plateMat.dispose();
      faceGeo.dispose();
      faceMat.dispose();
      rungs.geometry.dispose();
      rungMat.dispose();
      bird.geometry.dispose();
      birdMat.dispose();
      halo.geometry.dispose();
      haloMat.dispose();
      trail.geometry.dispose();
      trailMat.dispose();
    },
  };
}
