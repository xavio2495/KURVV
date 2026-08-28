import * as THREE from "three";
import { GROUND } from "./palette";

/**
 * WORLD SPACE — fixed for every object on the stage.
 *
 *   X  time.   `now` is x = 0. Past runs to -X, the drawable future to +X.
 *   Y  price.  Mapped through the shared extent so lanes are comparable.
 *   Z  lane depth. The active lane is z = 0; coarser intervals recede to -Z.
 *
 * Everything the chart and the console draw agrees on this. A helper that returns
 * pixels has no place here — the draw overlay converts once, at the boundary.
 */
export const WORLD = {
  /** Half-width of the time axis in world units. */
  spanX: 11,
  /** Fraction of spanX reserved for future time — the drawable region. */
  futureFraction: 0.32,
  /** Vertical extent the price extent maps onto. */
  spanY: 3.6,
  /** Centre-to-centre lane spacing, receding into -Z. */
  laneGap: 2.15,
  /** Lane ribbon width in Z. */
  laneWidth: 1.25,
} as const;

/** Time in seconds → world X, given the visible window. */
export function timeToX(t: number, now: number, horizonSec: number): number {
  const future = WORLD.spanX * WORLD.futureFraction;
  const past = WORLD.spanX * 2 - future;
  const pastSec = (horizonSec / WORLD.futureFraction) * (1 - WORLD.futureFraction);
  const dt = t - now;
  return dt >= 0 ? (dt / horizonSec) * future : (dt / pastSec) * past;
}

/** Price → world Y. */
export function priceToY(p: number, lo: number, hi: number): number {
  return ((p - lo) / Math.max(hi - lo, 1e-9)) * WORLD.spanY;
}

/**
 * The chart sits left of world origin so the drawable future span clears the console
 * float on the right. Every pose below is expressed in the SHIFTED frame.
 */
export const CHART_OFFSET_X = -3.3;

/** Total visible time for a horizon. Shared by the chart and its consumers. */
export function visibleSpanOf(horizonSec: number): number {
  return horizonSec / WORLD.futureFraction;
}

export interface Pose { pos: THREE.Vector3; target: THREE.Vector3 }

/** The two camera poses. Drawing flattens to head-on; releasing returns to depth. */
export const POSE = {
  depth: { pos: new THREE.Vector3(-11.2, 4.7, 13.1), target: new THREE.Vector3(-5.1, 1.05, -3.0) },
  flat: { pos: new THREE.Vector3(-1.54, 1.8, 10.2), target: new THREE.Vector3(-1.54, 1.8, 0) },
} as const;

/** cubic-bezier(.16,1,.3,1) as a scalar — the same ease the console UI uses. */
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  env: THREE.Texture;
  /** Drive the camera between POSE.depth (0) and POSE.flat (1). */
  setFlatten: (v: number) => void;
  /**
   * Orbit the depth pose by a pointer drag, in radians. Applied around POSE.depth's
   * target and clamped, so the stage can be inspected without ever losing the lanes
   * off-frame or dropping under the floor grid.
   */
  orbitBy: (dAzimuth: number, dElevation: number) => void;
  start: (onFrame: (dtSec: number, elapsed: number) => void) => void;
  dispose: () => void;
}

/**
 * A tiny procedural studio, baked to a PMREM cube.
 *
 * The clear shell is `transmission: 1` — with no environment it refracts nothing and
 * renders as flat grey. This buys a usable reflection without shipping an HDRI.
 */
function buildEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x0d0946);
  const box = (w: number, h: number, colour: number, intensity: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  box(9, 9, 0xffffff, 2.4, 0, 6, 2);      // key softbox above
  box(7, 7, 0xffd9a0, 1.5, -6, 1, 4);     // warm left
  box(7, 7, 0x8fb4ff, 1.4, 6, 1, 4);      // cool right
  box(9, 9, 0x2a1f4d, 0.9, 0, -5, 0);     // violet bounce below
  box(8, 8, 0xff6ad5, 0.7, 0, 0, -7);     // neon rim behind
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.04);
  pmrem.dispose();
  s.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
  });
  return rt.texture;
}

export function createStage(canvas: HTMLCanvasElement, wrap: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(GROUND, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(GROUND, 16, 42);
  const env = buildEnv(renderer);
  scene.environment = env;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

  // A single top-left key, matching the console's moulded-plastic read.
  const key = new THREE.DirectionalLight(0xfff9ca, 2.1);
  key.position.set(-6, 8, 9);
  const fill = new THREE.DirectionalLight(0xa9c4ff, 0.75);
  fill.position.set(7, 2, 5);
  scene.add(key, fill, new THREE.HemisphereLight(0xbfa8ff, 0x1a1230, 0.85), new THREE.AmbientLight(0xffffff, 0.22));

  let flatten = 0;
  const pos = new THREE.Vector3();
  const tgt = new THREE.Vector3();

  // The depth pose expressed as a spherical offset from its target, so a drag can
  // rotate it without the pose drifting away from what the chart was framed for.
  const base = new THREE.Spherical().setFromVector3(
    new THREE.Vector3().subVectors(POSE.depth.pos, POSE.depth.target),
  );
  const orbit = new THREE.Spherical(base.radius, base.phi, base.theta);
  const ORBIT = {
    phi: [0.35, 1.45] as const,            // never under the floor, never straight down
    theta: [base.theta - 1.15, base.theta + 0.75] as const,
  };
  const offset = new THREE.Vector3();
  const depthPos = new THREE.Vector3();

  const applyCamera = () => {
    offset.setFromSpherical(orbit);
    depthPos.addVectors(POSE.depth.target, offset);
    const k = easeOutExpo(flatten);
    pos.lerpVectors(depthPos, POSE.flat.pos, k);
    tgt.lerpVectors(POSE.depth.target, POSE.flat.target, k);
    camera.position.copy(pos);
    camera.lookAt(tgt);
  };
  applyCamera();

  const resize = () => {
    const w = wrap.clientWidth || 1;
    const h = wrap.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  let raf = 0;
  let last = performance.now();
  const t0 = last;

  return {
    scene, camera, renderer, env,
    setFlatten: (v) => { flatten = Math.min(1, Math.max(0, v)); applyCamera(); },
    orbitBy: (dA, dE) => {
      orbit.theta = Math.min(ORBIT.theta[1], Math.max(ORBIT.theta[0], orbit.theta + dA));
      orbit.phi = Math.min(ORBIT.phi[1], Math.max(ORBIT.phi[0], orbit.phi + dE));
      applyCamera();
    },
    start: (onFrame) => {
      const tick = () => {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.1); // clamp: a backgrounded tab
        last = now;
        onFrame(dt, (now - t0) / 1000);
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
          o.geometry.dispose();
          const m = o.material;
          Array.isArray(m) ? m.forEach((x) => x.dispose()) : m.dispose();
        }
      });
      env.dispose();
      renderer.dispose();
    },
  };
}

/**
 * The chart as a scene with NO renderer of its own.
 *
 * Split out so the chart can be rendered into a WebGLRenderTarget and used as the
 * device's screen texture. That collapses what were two WebGL contexts into one —
 * the single biggest cost in the old layout — and it is also what makes the screen a
 * real surface: a ray can hit it, so the display becomes a touch surface.
 */
export interface ChartWorld {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setFlatten: (v: number) => void;
  orbitBy: (dA: number, dE: number) => void;
  setAspect: (a: number) => void;
  dispose: () => void;
}

export function createChartWorld(): ChartWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(GROUND);
  scene.fog = new THREE.Fog(GROUND, 16, 42);

  const camera = new THREE.PerspectiveCamera(38, 1.1, 0.1, 120);

  const key = new THREE.DirectionalLight(0xfff9ca, 2.1);
  key.position.set(-6, 8, 9);
  const fill = new THREE.DirectionalLight(0xa9c4ff, 0.75);
  fill.position.set(7, 2, 5);
  scene.add(key, fill,
    new THREE.HemisphereLight(0xbfa8ff, 0x1a1230, 0.85),
    new THREE.AmbientLight(0xffffff, 0.22));

  const base = new THREE.Spherical().setFromVector3(
    new THREE.Vector3().subVectors(POSE.depth.pos, POSE.depth.target),
  );
  const orbit = new THREE.Spherical(base.radius, base.phi, base.theta);
  const LIMIT = {
    phi: [0.35, 1.45] as const,
    theta: [base.theta - 1.15, base.theta + 0.75] as const,
  };
  let flatten = 0;
  const offset = new THREE.Vector3();
  const depthPos = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const tgt = new THREE.Vector3();

  const apply = () => {
    offset.setFromSpherical(orbit);
    depthPos.addVectors(POSE.depth.target, offset);
    const k = easeOutExpo(flatten);
    pos.lerpVectors(depthPos, POSE.flat.pos, k);
    tgt.lerpVectors(POSE.depth.target, POSE.flat.target, k);
    camera.position.copy(pos);
    camera.lookAt(tgt);
  };
  apply();

  return {
    scene, camera,
    setFlatten: (v) => { flatten = Math.min(1, Math.max(0, v)); apply(); },
    orbitBy: (dA, dE) => {
      orbit.theta = Math.min(LIMIT.theta[1], Math.max(LIMIT.theta[0], orbit.theta + dA));
      orbit.phi = Math.min(LIMIT.phi[1], Math.max(LIMIT.phi[0], orbit.phi + dE));
      apply();
    },
    setAspect: (a) => { camera.aspect = a; camera.updateProjectionMatrix(); },
    dispose: () => {
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          const m = o.material;
          Array.isArray(m) ? m.forEach((x) => x.dispose()) : m.dispose();
        }
      });
    },
  };
}
