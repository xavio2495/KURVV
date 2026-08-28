import * as THREE from "three";
import type { Skin } from "../skins";

/**
 * The ambient field behind the device.
 *
 * One `Points` cloud with a per-vertex colour drawn from the skin's lane palette, so
 * the field is always the same family as the chart it surrounds. Motion is computed
 * in the vertex data rather than per-particle objects — 900 meshes would cost more
 * than the device itself.
 */
const COUNT = 2600;
const SPREAD = { x: 54, y: 34, z: 22 };

export interface Field {
  points: THREE.Points;
  applySkin: (s: Skin) => void;
  update: (dt: number, elapsed: number) => void;
  dispose: () => void;
}

export function createParticles(skin: Skin): Field {
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const drift = new Float32Array(COUNT);
  // Deterministic: the same field every load, and no RNG in a render path.
  let seed = 21;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (rnd() - 0.5) * SPREAD.x;
    pos[i * 3 + 1] = (rnd() - 0.5) * SPREAD.y;
    // Always behind the device, never in front of the screen.
    pos[i * 3 + 2] = -4 - rnd() * SPREAD.z;
    drift[i] = 0.15 + rnd() * 0.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.2, vertexColors: true, transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const c = new THREE.Color();
  const applySkin = (s: Skin) => {
    for (let i = 0; i < COUNT; i++) {
      c.setHex(s.lanes[i % s.lanes.length]);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.attributes.color.needsUpdate = true;
  };
  applySkin(skin);

  return {
    points, applySkin,
    update: (dt) => {
      const a = geo.attributes.position as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      for (let i = 0; i < COUNT; i++) {
        arr[i * 3 + 1] += drift[i] * dt;
        // Wrap rather than respawn: no allocation in the loop.
        if (arr[i * 3 + 1] > SPREAD.y / 2) arr[i * 3 + 1] = -SPREAD.y / 2;
      }
      a.needsUpdate = true;
    },
    dispose: () => { geo.dispose(); mat.dispose(); },
  };
}
