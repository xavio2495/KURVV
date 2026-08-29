import * as THREE from "three";
import { GRID_FAINT, GRID_WINDOW, STATE } from "./palette";
import { WORLD, priceToY, timeToX, visibleSpanOf } from "./stage";
import type { Bucket } from "./buckets";
import type { LegView } from "../render/types";
import { PIXEL_HEIGHT, PIXEL_ROWS, type PixelCells } from "../pixel";
import { createGates, type GatesData } from "./gates";

/**
 * ONE price timeline, drawn as a streak.
 *
 * Four stacked lanes were decoration: they showed the same series at four
 * resolutions, which is interesting once and then competes with the thing that
 * actually matters — where the price is and where the user thinks it is going. One
 * line, rendered as a bright core inside a soft halo, reads at a glance and leaves
 * the frame to the Curve and the Legs.
 *
 * The geometry is a tube swept along a Catmull-Rom through the samples, so the line
 * has a round cross-section and catches light along its length instead of being a
 * flat ribbon that vanishes edge-on.
 */

/** Samples across the visible span. Enough to read as a line, few enough to sweep. */
const SAMPLES = 190;
const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Bucket width for the timeline, derived so the span always fills the frame. */
export function timelineInterval(horizonSec: number): number {
  const want = visibleSpanOf(horizonSec) / SAMPLES;
  for (const n of NICE) if (n >= want) return n;
  return NICE[NICE.length - 1];
}

export function intervalLabel(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

/** A drawn point, normalised. `u` runs across the future span, `v` bottom-to-top. */
export interface DrawPoint { u: number; v: number }

export interface ChartData {
  buckets: Bucket[];
  interval: number;
  extent: { lo: number; hi: number };
  now: number;
  horizonSec: number;
  legs: LegView[];
  /**
   * Every drawn Curve, oldest first. The LAST is the active one — the Plan that
   * commits — and the rest are kept on screen to compare against.
   */
  curves: DrawPoint[][] | null;
  /** Pixel mode's painted grid, or null in draw mode. */
  cells: PixelCells | null;
  /**
   * Flappy mode's gates and bird, already normalised. `null` in every other mode.
   * The caller owns the mapping so this scene never has to know whether it is
   * showing a live run or a replay of finished Windows.
   */
  gates: Omit<GatesData, "rect"> | null;
  legCount: number;
  planStart: number | null;
  /** Line colour, taken from the active skin so the chart matches its device. */
  tint: number;
}

const MAX_LEGS = 8;

export interface Chart {
  group: THREE.Group;
  update: (d: ChartData, elapsed: number) => void;
  drawRect: () => { x0: number; x1: number; y0: number; y1: number; z: number };
  dispose: () => void;
}

/**
 * A streak: a bright core tube inside a wider translucent one.
 *
 * Two meshes rather than a shader — the halo is additive and depth-write-off, so it
 * glows over the grid without needing a post-processing pass the device's render
 * target would have to pay for every frame.
 */
function makeStreak(colour: number, core: number, halo: number) {
  const coreMat = new THREE.MeshStandardMaterial({
    color: colour, emissive: colour, emissiveIntensity: 1.5, roughness: 0.35, toneMapped: false,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity: 0.16, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const coreMesh = new THREE.Mesh(new THREE.BufferGeometry(), coreMat);
  const haloMesh = new THREE.Mesh(new THREE.BufferGeometry(), haloMat);
  coreMesh.frustumCulled = false;
  haloMesh.frustumCulled = false;
  coreMesh.visible = haloMesh.visible = false;

  /** Rebuild both tubes from a path. Callers must gate this on a change key. */
  const set = (pts: THREE.Vector3[]) => {
    coreMesh.geometry.dispose();
    haloMesh.geometry.dispose();
    if (pts.length < 2) {
      coreMesh.visible = haloMesh.visible = false;
      coreMesh.geometry = new THREE.BufferGeometry();
      haloMesh.geometry = new THREE.BufferGeometry();
      return;
    }
    const path = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.35);
    const seg = Math.min(360, Math.max(24, pts.length * 2));
    coreMesh.geometry = new THREE.TubeGeometry(path, seg, core, 10, false);
    haloMesh.geometry = new THREE.TubeGeometry(path, seg, halo, 8, false);
    coreMesh.visible = haloMesh.visible = true;
  };

  return {
    meshes: [haloMesh, coreMesh] as const,
    set,
    setColour: (c: number) => { coreMat.color.setHex(c); coreMat.emissive.setHex(c); haloMat.color.setHex(c); },
    dispose: () => {
      coreMesh.geometry.dispose();
      haloMesh.geometry.dispose();
      coreMat.dispose();
      haloMat.dispose();
    },
  };
}

export function createChart(): Chart {
  const group = new THREE.Group();
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
    for (const c of gridGroup.children) {
      const m = c as THREE.LineSegments;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    gridGroup.clear();
    const zBack = -WORLD.laneGap * 1.6;
    const zFront = WORLD.laneWidth;
    const faint: number[] = [];
    const loud: number[] = [];
    const pastSec = visibleSpanOf(horizonSec) * (1 - WORLD.futureFraction);
    for (let t = -Math.ceil(pastSec / horizonSec) * horizonSec; t <= horizonSec * 1.05; t += horizonSec) {
      const x = timeToX(now + t, now, horizonSec);
      (Math.abs(t) < 1 ? loud : faint).push(x, 0, zFront, x, 0, zBack);
    }
    for (let i = 0; i <= 3; i++) {
      const z = -i * (WORLD.laneGap * 0.55) + WORLD.laneWidth / 2;
      faint.push(-WORLD.spanX, 0, z, WORLD.spanX, 0, z);
    }
    const mk = (pts: number[], colour: number, opacity: number) => {
      if (!pts.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      gridGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity })));
    };
    mk(faint, GRID_FAINT, 0.45);
    mk(loud, GRID_WINDOW, 0.8);
  };

  // ── the price streak ─────────────────────────────────────────────────────
  const price = makeStreak(0xff6ad5, 0.045, 0.15);
  group.add(...price.meshes);
  let priceKey = "";
  let tint = 0;

  /**
   * The head of the timeline — an actual cursor, not just where the tube stops.
   *
   * A streak that simply ends reads as a line that got cut off. A bead with a halo
   * and a level line running out into the future span says "the price is HERE, and
   * this is the height you are drawing against", which is the one reference the
   * whole gesture is made relative to.
   */
  const capMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.25, toneMapped: false,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const levelMat = new THREE.LineDashedMaterial({
    color: 0xffffff, transparent: true, opacity: 0.42, dashSize: 0.16, gapSize: 0.16,
  });
  const cap = new THREE.Group();
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), capMat);
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.235, 36), haloMat);
  cap.add(bead, halo);
  cap.visible = false;
  group.add(cap);

  const levelGeo = new THREE.BufferGeometry();
  levelGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
  const level = new THREE.Line(levelGeo, levelMat);
  level.computeLineDistances();
  level.frustumCulled = false;
  level.visible = false;
  group.add(level);

  // ── the drawn Curves ─────────────────────────────────────────────────────
  /**
   * The active Curve is a full streak; the earlier ones are thin lines.
   *
   * Deliberately not a pool of streaks. Sweeping a tube per Curve would multiply the
   * one genuinely expensive thing in this scene, and a ghost that reads as loudly as
   * the live line defeats the reason for keeping it — you cannot tell which Curve
   * the strip and the commit key are talking about.
   */
  const curve = makeStreak(STATE.curve, 0.05, 0.17);
  group.add(...curve.meshes);
  let curveKey = "";

  const GHOST_MAX = 5;
  const ghostMat = new THREE.LineBasicMaterial({ color: STATE.curve, transparent: true, opacity: 0.3 });
  const ghosts: THREE.Line[] = [];
  for (let i = 0; i < GHOST_MAX; i++) {
    const l = new THREE.Line(new THREE.BufferGeometry(), ghostMat);
    l.frustumCulled = false;
    l.visible = false;
    ghosts.push(l);
    group.add(l);
  }
  let ghostKey = "";

  /**
   * PIXEL MODE — the grid.
   *
   * One instanced quad per cell, so a 7x8 grid is a single draw call and repainting
   * a column is a matrix write rather than a rebuild. The lattice behind it is a
   * separate `LineSegments`, rebuilt only when the column count changes.
   *
   * The centre row is drawn differently on purpose: it is the one row that takes no
   * position, and a grid where "skip" looks like every other cell invites a Plan the
   * user did not mean to make.
   */
  const CELL_MAX = 8 * PIXEL_HEIGHT;
  const cellGeo = new THREE.PlaneGeometry(1, 1);
  const cellMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, side: THREE.DoubleSide, toneMapped: false });
  const cellMesh = new THREE.InstancedMesh(cellGeo, cellMat, CELL_MAX);
  cellMesh.frustumCulled = false;
  cellMesh.count = 0;
  cellMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CELL_MAX * 3), 3);
  group.add(cellMesh);

  const latticeMat = new THREE.LineBasicMaterial({ color: GRID_FAINT, transparent: true, opacity: 0.5 });
  const lattice = new THREE.LineSegments(new THREE.BufferGeometry(), latticeMat);
  lattice.frustumCulled = false;
  lattice.visible = false;
  group.add(lattice);
  let latticeKey = "";

  const buildLattice = (x0: number, x1: number, cols: number) => {
    const k = `${cols}:${x0.toFixed(3)}:${x1.toFixed(3)}`;
    if (k === latticeKey) return;
    latticeKey = k;
    const pts: number[] = [];
    const top = WORLD.spanY;
    for (let c = 0; c <= cols; c++) {
      const x = x0 + (c / cols) * (x1 - x0);
      pts.push(x, 0, 0.01, x, top, 0.01);
    }
    for (let r = 0; r <= PIXEL_HEIGHT; r++) {
      const y = (r / PIXEL_HEIGHT) * top;
      pts.push(x0, y, 0.01, x1, y, 0.01);
    }
    lattice.geometry.dispose();
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    lattice.geometry = g2;
  };

  // ── Leg blocks ───────────────────────────────────────────────────────────
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const legMat = new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.1, transparent: true, opacity: 0.9 });
  const legMesh = new THREE.InstancedMesh(unit, legMat, MAX_LEGS);
  legMesh.frustumCulled = false;
  legMesh.count = 0;
  legMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEGS * 3), 3);
  group.add(legMesh);

  // ── flappy: the gates and the bird ───────────────────────────────────────
  const gates = createGates();
  group.add(gates.group);

  // ── the `now` plane ──────────────────────────────────────────────────────
  const nowMat = new THREE.MeshBasicMaterial({ color: STATE.gold, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
  const nowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nowMat);
  group.add(nowPlane);

  let rect = { x0: 0, x1: 1, y0: 0, y1: WORLD.spanY, z: 0 };

  const update = (d: ChartData, elapsed: number) => {
    const { now, horizonSec, extent } = d;
    buildGrid(now, horizonSec);

    if (d.tint !== tint) {
      tint = d.tint;
      price.setColour(tint);
      capMat.color.setHex(tint);
      capMat.emissive.setHex(tint);
      haloMat.color.setHex(tint);
      levelMat.color.setHex(tint);
    }

    // The tube is swept, not per-frame cheap: only rebuild when the series moves.
    const pk = `${d.buckets.length}:${d.buckets.at(-1)?.t ?? 0}:${extent.lo.toFixed(2)}:${horizonSec}`;
    if (pk !== priceKey) {
      priceKey = pk;
      const pts: THREE.Vector3[] = [];
      for (const b of d.buckets) {
        pts.push(new THREE.Vector3(
          timeToX(b.t + d.interval / 2, now, horizonSec),
          priceToY(b.close, extent.lo, extent.hi),
          0,
        ));
      }
      price.set(pts);
    }
    const flying = !!d.gates;
    price.meshes.forEach((m) => { m.visible = !flying && d.buckets.length > 1; });

    // Legs, on the timeline.
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
        const y = leg.entryPrice !== undefined ? priceToY(leg.entryPrice, extent.lo, extent.hi) : WORLD.spanY * 0.5;
        m4.makeScale(Math.max(w * 0.94, 1e-4), Math.max(h, 1e-4), WORLD.laneWidth * 1.2);
        m4.setPosition(xa + w / 2, y, 0);
        legMesh.setMatrixAt(ln, m4);
        const base =
          leg.state === "won" ? STATE.won
          : leg.state === "lost" ? STATE.lost
          : leg.state === "open" ? STATE.gold
          : leg.state === "skipped" || leg.state === "void" ? STATE.skipped
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

    // The cursor sits on the last observation, and the level line runs from it to
    // the far edge of the drawable span.
    const head = d.buckets.at(-1);
    cap.visible = level.visible = head !== undefined && !d.gates;
    if (head) {
      const hx = timeToX(head.t + d.interval / 2, now, horizonSec);
      const hy = priceToY(head.close, extent.lo, extent.hi);
      cap.position.set(hx, hy, 0);
      // Breathing, so a live feed is distinguishable from a frozen one at a glance.
      const pulse = 1 + 0.16 * Math.sin(elapsed * 2.6);
      halo.scale.setScalar(pulse);
      haloMat.opacity = 0.34 + 0.14 * Math.sin(elapsed * 2.6 + Math.PI / 2);

      const pos = levelGeo.getAttribute("position") as THREE.BufferAttribute;
      pos.setXYZ(0, hx, hy, 0);
      pos.setXYZ(1, x1, hy, 0);
      pos.needsUpdate = true;
      levelGeo.computeBoundingSphere();
      level.computeLineDistances();
    }

    // ── flappy: gates over the whole visible span, not just the future ─────
    // A replay is history, so it needs the full width; a live run still reads
    // correctly because its gates simply sit in the right-hand portion.
    gates.update(d.gates ? { ...d.gates, rect: { x0: -WORLD.spanX, x1: WORLD.spanX } } : null, elapsed);

    // ── the grid, when pixel mode is on ────────────────────────────────────
    const cells = d.cells;
    const cols = Math.max(1, d.legCount);
    lattice.visible = !!cells;
    if (cells) {
      buildLattice(x0, x1, cols);
      const cw = (x1 - x0) / cols;
      const ch = WORLD.spanY / PIXEL_HEIGHT;
      let ci = 0;
      for (let c = 0; c < cols && ci < CELL_MAX; c++) {
        const painted = cells[c];
        for (let band = 0; band < PIXEL_HEIGHT; band++) {
          const row = band - PIXEL_ROWS;
          const on = painted !== undefined && painted !== 0
            && ((painted > 0 && row > 0 && row <= painted) || (painted < 0 && row < 0 && row >= painted));
          const centre = row === 0;
          if (!on && !centre) continue;
          if (ci >= CELL_MAX) break;
          m4.makeScale(cw * 0.88, ch * 0.82, 1);
          m4.setPosition(x0 + (c + 0.5) * cw, (band + 0.5) * ch, 0.015);
          cellMesh.setMatrixAt(ci, m4);
          if (centre) {
            // The skip row: present, readable, and obviously not a position.
            col.setHex(painted === 0 ? STATE.skipped : GRID_WINDOW);
            col.multiplyScalar(painted === 0 ? 0.9 : 0.28);
          } else {
            col.setHex(painted! > 0 ? STATE.up : STATE.down);
            // The tip of a stack is brightest, so height reads as conviction.
            col.multiplyScalar(0.55 + 0.45 * (Math.abs(row) / Math.abs(painted!)));
          }
          cellMesh.setColorAt(ci, col);
          ci++;
        }
      }
      cellMesh.count = ci;
      cellMesh.instanceMatrix.needsUpdate = true;
      if (cellMesh.instanceColor) cellMesh.instanceColor.needsUpdate = true;
    } else {
      cellMesh.count = 0;
    }

    // The Curve gets the same streak treatment: a drawn line should look drawn, not
    // like a row of blocks left behind by the pointer.
    const all = (d.curves ?? []).filter((c) => c.length > 1);
    const active = all.length ? all[all.length - 1] : null;

    const toWorld = (c: DrawPoint[], z: number) => {
      const pts: THREE.Vector3[] = [];
      const step = Math.max(1, Math.floor(c.length / 90));
      for (let i = 0; i < c.length; i += step) {
        pts.push(new THREE.Vector3(x0 + c[i].u * (x1 - x0), c[i].v * WORLD.spanY, z));
      }
      const last = c[c.length - 1];
      pts.push(new THREE.Vector3(x0 + last.u * (x1 - x0), last.v * WORLD.spanY, z));
      return pts;
    };

    const ck = active ? `${all.length}:${active.length}:${active.at(-1)?.u.toFixed(3)}:${active.at(-1)?.v.toFixed(3)}` : "";
    if (ck !== curveKey) {
      curveKey = ck;
      curve.set(active ? toWorld(active, 0.02) : []);
    }

    /**
     * Who owns the frame, decided every frame.
     *
     * Not switched off when a mode starts: the streak's own visibility is only
     * touched when its change key moves, so a mode that hid it left it hidden until
     * the user drew again.
     */
    const drawnVisible = !d.cells && !d.gates && !!active;
    curve.meshes.forEach((m) => { m.visible = drawnVisible; });

    // The ghosts only change when a Curve is finished, never mid-stroke.
    const gk = all.slice(0, -1).map((c) => c.length).join(",");
    if (gk !== ghostKey) {
      ghostKey = gk;
      const older = all.slice(0, -1).slice(-GHOST_MAX);
      ghosts.forEach((l, i) => {
        const c = older[i];
        l.geometry.dispose();
        l.userData.live = !!c;
        l.geometry = c ? new THREE.BufferGeometry().setFromPoints(toWorld(c, 0.018)) : new THREE.BufferGeometry();
      });
    }
    for (const l of ghosts) l.visible = drawnVisible && !!l.userData.live;

    nowPlane.position.set(x0, WORLD.spanY / 2, -WORLD.laneGap * 0.8);
    nowPlane.scale.set(0.03, WORLD.spanY, 1);
    nowPlane.rotation.y = Math.PI / 2;
    nowMat.opacity = 0.12 + 0.06 * Math.sin(elapsed * 2);
  };

  return {
    group, update,
    drawRect: () => rect,
    dispose: () => {
      price.dispose();
      curve.dispose();
      bead.geometry.dispose();
      halo.geometry.dispose();
      capMat.dispose();
      haloMat.dispose();
      levelGeo.dispose();
      levelMat.dispose();
      cellGeo.dispose();
      cellMat.dispose();
      gates.dispose();
      for (const l of ghosts) l.geometry.dispose();
      ghostMat.dispose();
      lattice.geometry.dispose();
      latticeMat.dispose();
      unit.dispose();
      legMat.dispose();
      nowPlane.geometry.dispose();
      nowMat.dispose();
    },
  };
}
