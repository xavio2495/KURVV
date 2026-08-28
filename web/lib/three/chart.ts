import * as THREE from "three";
import { GRID_FAINT, GRID_WINDOW, LANE, STATE } from "./palette";
import { WORLD, priceToY, timeToX } from "./stage";
import type { Bucket } from "./buckets";
import type { LegView } from "../render/types";

/**
 * LANE RESOLUTIONS are derived from the visible span, not fixed.
 *
 * Every lane shares one X axis, so they share one visible span — and that span is a
 * function of the Plan's horizon, which the user changes. Fixed intervals break at
 * both ends: 15m buckets give a single block on the 60s venue, and 15s buckets give
 * thousands on the 15m one. Deriving from the span keeps every lane filled at any
 * horizon, and the resolutions are then reported honestly in the legend.
 */
const LANE_TARGET_BUCKETS = [220, 75, 26, 9] as const;
const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 86400];

/** Total visible time, in seconds, for a given horizon. */
export function visibleSpan(horizonSec: number): number {
  return horizonSec / WORLD.futureFraction;
}

function nice(sec: number): number {
  for (const n of NICE) if (n >= sec) return n;
  return NICE[NICE.length - 1];
}

/** The four lane bucket widths, coarsest last. Always well-filled. */
export function laneIntervals(horizonSec: number): number[] {
  const span = visibleSpan(horizonSec);
  const out: number[] = [];
  for (const target of LANE_TARGET_BUCKETS) {
    const want = nice(span / target);
    // Never repeat a resolution — a duplicated lane is a lie about the data.
    out.push(out.length && want <= out[out.length - 1] ? nice(out[out.length - 1] + 1) : want);
  }
  return out;
}

export function laneLabel(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

/** A drawn point, normalised. `u` runs across the future span, `v` bottom-to-top. */
export interface DrawPoint { u: number; v: number }

export interface ChartData {
  /** One bucket array per lane, coarsest last. */
  lanes: Bucket[][];
  laneIntervals: number[];
  extent: { lo: number; hi: number };
  now: number;
  horizonSec: number;
  legs: LegView[];
  curve: DrawPoint[] | null;
  planStart: number | null;
}

const LANES = 4;
const MAX_BUCKETS = 1200;
const MAX_LEGS = 8;
const MAX_TRAIL = 260;

function place(
  mesh: THREE.InstancedMesh, i: number, m: THREE.Matrix4,
  x: number, y: number, z: number, w: number, h: number, d: number,
) {
  m.makeScale(Math.max(w, 1e-4), Math.max(h, 1e-4), Math.max(d, 1e-4));
  m.setPosition(x, y, z);
  mesh.setMatrixAt(i, m);
}

export interface Chart {
  group: THREE.Group;
  update: (d: ChartData, elapsed: number) => void;
  /** World-space rect of the drawable future region, for the draw overlay. */
  drawRect: () => { x0: number; x1: number; y0: number; y1: number; z: number };
}

export function createChart(): Chart {
  const group = new THREE.Group();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();

  // ── floor grid ───────────────────────────────────────────────────────────
  const gridGroup = new THREE.Group();
  group.add(gridGroup);
  let gridKey = "";
  const buildGrid = (now: number, horizonSec: number) => {
    const k = `${horizonSec}`;
    if (k === gridKey) return;
    gridKey = k;
    gridGroup.clear();
    const zBack = -WORLD.laneGap * (LANES - 0.4);
    const zFront = WORLD.laneWidth;
    const faint: number[] = [];
    const loud: number[] = [];
    const pastSec = visibleSpan(horizonSec) * (1 - WORLD.futureFraction);
    for (let t = -Math.ceil(pastSec / horizonSec) * horizonSec; t <= horizonSec * 1.05; t += horizonSec) {
      const x = timeToX(now + t, now, horizonSec);
      (Math.abs(t) < 1 ? loud : faint).push(x, 0, zFront, x, 0, zBack);
    }
    for (let i = 0; i <= LANES; i++) {
      const z = -i * WORLD.laneGap + WORLD.laneWidth / 2;
      faint.push(-WORLD.spanX, 0, z, WORLD.spanX, 0, z);
    }
    const mk = (pts: number[], colour: number, opacity: number) => {
      if (!pts.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      gridGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity })));
    };
    mk(faint, GRID_FAINT, 0.5);
    mk(loud, GRID_WINDOW, 0.85);
  };

  // ── price lanes ──────────────────────────────────────────────────────────
  const laneMeshes = Array.from({ length: LANES }, (_, i) => {
    const mat = new THREE.MeshStandardMaterial({
      color: LANE[i], emissive: LANE[i],
      emissiveIntensity: 0.6 - i * 0.1, roughness: 0.4, metalness: 0.05,
    });
    const mesh = new THREE.InstancedMesh(unit, mat, MAX_BUCKETS);
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  });

  // ── Leg blocks, on the active (nearest) lane ─────────────────────────────
  const legMat = new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.1, transparent: true, opacity: 0.92 });
  const legMesh = new THREE.InstancedMesh(unit, legMat, MAX_LEGS);
  legMesh.frustumCulled = false;
  legMesh.count = 0;
  legMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEGS * 3), 3);
  group.add(legMesh);

  // ── drawn Curve, as a cube trail ─────────────────────────────────────────
  const trailMat = new THREE.MeshStandardMaterial({
    color: STATE.curve, emissive: STATE.curve, emissiveIntensity: 2.2, roughness: 0.28, toneMapped: false,
  });
  const trail = new THREE.InstancedMesh(unit, trailMat, MAX_TRAIL);
  trail.frustumCulled = false;
  trail.count = 0;
  group.add(trail);

  // ── the `now` plane ──────────────────────────────────────────────────────
  const nowMat = new THREE.MeshBasicMaterial({ color: STATE.gold, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
  const nowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nowMat);
  group.add(nowPlane);

  let rect = { x0: 0, x1: 1, y0: 0, y1: 1, z: 0 };

  const update = (d: ChartData, elapsed: number) => {
    const { now, horizonSec, extent } = d;
    buildGrid(now, horizonSec);

    const THICK = 0.05;
    for (let li = 0; li < LANES; li++) {
      const mesh = laneMeshes[li];
      const buckets = d.lanes[li] ?? [];
      const z = -li * WORLD.laneGap;
      const interval = d.laneIntervals[li];
      let n = 0;
      let prevY: number | null = null;
      let prevX = 0;
      for (const b of buckets) {
        if (n >= MAX_BUCKETS - 1) break;
        const xa = timeToX(b.t, now, horizonSec);
        const xb = timeToX(b.t + interval, now, horizonSec);
        const w = xb - xa;
        if (w <= 0) continue;
        const y = priceToY(b.close, extent.lo, extent.hi);
        // The tread.
        place(mesh, n++, m4, xa + w / 2, y, z, w, THICK, WORLD.laneWidth);
        // The riser. Without it the lane is a field of disconnected slabs; with it
        // the lane reads as one continuous stepped ribbon, which is the whole point.
        if (prevY !== null && Math.abs(y - prevY) > THICK && xa - prevX < interval * 2.5) {
          place(mesh, n++, m4, xa, (y + prevY) / 2, z, THICK * 0.9, Math.abs(y - prevY), WORLD.laneWidth);
        }
        prevY = y;
        prevX = xb;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }

    // Legs — bands along the active lane, one per Window.
    let ln = 0;
    if (d.planStart !== null) {
      for (const leg of d.legs) {
        if (ln >= MAX_LEGS) break;
        const xa = timeToX(leg.start, now, horizonSec);
        const xb = timeToX(leg.end, now, horizonSec);
        const w = xb - xa;
        if (w <= 0) continue;
        // Height carries conviction: a heavier Leg is a taller block.
        const h = 0.12 + Math.min(Number(leg.stake) / 1e6, 4) * 0.13;
        const y = leg.entryPrice !== undefined
          ? priceToY(leg.entryPrice, extent.lo, extent.hi)
          : WORLD.spanY * 0.5;
        place(legMesh, ln, m4, xa + w / 2, y, 0, w * 0.94, h, WORLD.laneWidth * 1.3);
        const base =
          leg.state === "won" ? STATE.won
          : leg.state === "lost" ? STATE.lost
          : leg.state === "open" ? STATE.gold
          : leg.state === "skipped" ? STATE.skipped
          : leg.direction === "UP" ? STATE.up : STATE.down;
        col.setHex(base);
        // An open Leg breathes, so "the chain is working" is visible without text.
        if (leg.state === "open") col.multiplyScalar(0.78 + 0.3 * Math.sin(elapsed * 3.1));
        else if (leg.state === "pending") col.multiplyScalar(0.42);
        legMesh.setColorAt(ln, col);
        ln++;
      }
    }
    legMesh.count = ln;
    legMesh.instanceMatrix.needsUpdate = true;
    if (legMesh.instanceColor) legMesh.instanceColor.needsUpdate = true;

    const x0 = timeToX(now, now, horizonSec);
    const x1 = timeToX(now + horizonSec, now, horizonSec);
    rect = { x0, x1, y0: 0, y1: WORLD.spanY, z: 0 };

    let tn = 0;
    if (d.curve && d.curve.length > 1) {
      const step = Math.max(1, Math.ceil(d.curve.length / MAX_TRAIL));
      for (let i = 0; i < d.curve.length; i += step) {
        if (tn >= MAX_TRAIL) break;
        const p = d.curve[i];
        place(trail, tn++, m4, x0 + p.u * (x1 - x0), p.v * WORLD.spanY, 0, 0.15, 0.15, 0.15);
      }
    }
    trail.count = tn;
    trail.instanceMatrix.needsUpdate = true;

    nowPlane.position.set(x0, WORLD.spanY / 2, -WORLD.laneGap * 1.5);
    nowPlane.scale.set(0.03, WORLD.spanY, 1);
    nowPlane.rotation.y = Math.PI / 2;
    nowMat.opacity = 0.12 + 0.06 * Math.sin(elapsed * 2);
  };

  return { group, update, drawRect: () => rect };
}
