import * as THREE from "three";

/** Rounded-rectangle outline, centred on the origin. */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = w / 2;
  const y = h / 2;
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r);
  s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r);
  s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}

/** The same outline as a Path, for punching a hole. */
export function roundedHole(cx: number, cy: number, w: number, h: number, r: number): THREE.Path {
  const p = new THREE.Path();
  const x = w / 2;
  const y = h / 2;
  p.moveTo(cx - x + r, cy - y);
  p.lineTo(cx + x - r, cy - y);
  p.quadraticCurveTo(cx + x, cy - y, cx + x, cy - y + r);
  p.lineTo(cx + x, cy + y - r);
  p.quadraticCurveTo(cx + x, cy + y, cx + x - r, cy + y);
  p.lineTo(cx - x + r, cy + y);
  p.quadraticCurveTo(cx - x, cy + y, cx - x, cy + y - r);
  p.lineTo(cx - x, cy - y + r);
  p.quadraticCurveTo(cx - x, cy - y, cx - x + r, cy - y);
  return p;
}

export function circleHole(cx: number, cy: number, r: number): THREE.Path {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return p;
}

/** The clear shell, shared by every object on the float layer. */
export function clearShell(env: THREE.Texture, tint: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: tint, transmission: 1, transparent: true,
    roughness: 0.24, metalness: 0, ior: 1.47, thickness: 0.42,
    clearcoat: 1, clearcoatRoughness: 0.18, envMap: env, envMapIntensity: 1.5,
    attenuationColor: new THREE.Color(0xdfe6ec), attenuationDistance: 2.4,
  });
}

/**
 * Extrude a shape and sit its FRONT face on z = 0.
 *
 * Not `.center()`. Aligning the front face to a known plane is what makes every
 * child placement predictable: a cap at z = 0.02 is 0.02 proud of the body, always.
 * Centring instead leaves the face at half-depth-plus-bevel, which is the trap that
 * buried three separate parts in earlier passes.
 */
export function extrudeFront(shape: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 12, curveSegments: 48,
  });
  g.computeBoundingBox();
  g.translate(0, 0, -g.boundingBox!.max.z);
  g.computeVertexNormals();
  return g;
}

/** Ring of 48 points around a rounded rectangle at a given depth. */
function ringPoints(w: number, h: number, r: number, z: number): number[] {
  const x = w / 2;
  const y = h / 2;
  const out: number[] = [];
  const corners: [number, number, number][] = [
    [x - r, y - r, 0], [-x + r, y - r, Math.PI / 2],
    [-x + r, -y + r, Math.PI], [x - r, -y + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i < 12; i++) {
      const a = a0 + (i / 12) * (Math.PI / 2);
      out.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z);
    }
  }
  return out;
}

/**
 * The WALL of a recess: a stitched band from the body's face down to the pocket floor.
 *
 * This is the part a box-shadow can never be. A real wall catches the key light on
 * one side and falls into shadow on the other, which is the entire reason a pocket
 * reads as depth rather than as a dark rectangle painted on a flat panel.
 */
export function pocketWall(w: number, h: number, r: number, pad: number): THREE.BufferGeometry {
  const outer = ringPoints(w + pad * 2, h + pad * 2, Math.min(r + pad, (w + pad * 2) / 2, (h + pad * 2) / 2), 0);
  const inner = ringPoints(w, h, r, -pad);
  const pos = [...outer, ...inner];
  const idx: number[] = [];
  for (let i = 0; i < 48; i++) {
    const j = (i + 1) % 48;
    idx.push(i, 48 + i, j, j, 48 + i, 48 + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A knurled grip, as a bump map.
 *
 * Grooves are cut along one axis with a `1 - sin(t*PI)` falloff so each one has a
 * rounded bottom rather than a hard step, and the band is inset from the rim so the
 * knurl stops before the wheel's rounded edges. Wrapped and repeated around the
 * circumference; the geometry stays a plain lathe.
 */
export function knurlBump(opts: {
  ridgeWidth: number; grooveWidth: number; depth: number; ridgeLength: number; repeat: number;
}): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d")!;
  const img = g.createImageData(S, S);
  const period = opts.ridgeWidth + opts.grooveWidth;
  const margin = (1 - opts.ridgeLength) / 2;
  const y0 = margin * S;
  const y1 = (1 - margin) * S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 255;
      if (y >= y0 && y <= y1) {
        const p = x % period;
        if (p < opts.grooveWidth) {
          const t = p / opts.grooveWidth;
          v = Math.round((1 - Math.sin(t * Math.PI)) * opts.depth * 255);
        }
      }
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(opts.repeat, 1);
  return t;
}

/** Recompute planar UVs from the bounding box, so a face texture maps predictably. */
export function planarUV(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const w = b.max.x - b.min.x;
  const h = b.max.y - b.min.y;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - b.min.x) / w, (pos.getY(i) - b.min.y) / h);
  }
  uv.needsUpdate = true;
}
