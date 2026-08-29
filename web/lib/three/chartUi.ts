import * as THREE from "three";

/**
 * Controls that live INSIDE the chart display.
 *
 * The main screen is a render target that a ray can hit, so it is a real touch
 * surface — which means a control drawn into the chart scene is a control the user
 * can press with a finger, no DOM overlay floating above the glass. Parenting the
 * group to the chart camera keeps it pinned to the display's corner no matter where
 * the chart itself has been orbited to.
 *
 * A hit arrives as a UV on the screen mesh. Because the render target is exactly
 * this camera's view, `uv * 2 - 1` IS the NDC to raycast with — no extra transform.
 */

export interface ChartUi {
  group: THREE.Group;
  /** Re-place the controls for a camera frustum. Call whenever the aspect changes. */
  layout: (fovDeg: number, aspect: number) => void;
  /** Paint the current state. Cheap; gated on a change key by the caller. */
  setFlat: (flat: boolean) => void;
  /** Hit test a screen UV. Returns the control id under it, or null. */
  pick: (uv: THREE.Vector2, camera: THREE.Camera) => string | null;
  dispose: () => void;
}

/** Distance in front of the camera. Anything in the scene is further than this. */
const Z = -2;
const PAD = 0.05;
const W = 0.155;
const H = 0.105;

function pill(ctx: CanvasRenderingContext2D, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(1.5, 1.5, w - 3, h - 3, r);
}

export function createChartUi(): ChartUi {
  const group = new THREE.Group();
  group.renderOrder = 998;

  const canvas = document.createElement("canvas");
  canvas.width = 186;
  canvas.height = 126;
  const g = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }),
  );
  mesh.renderOrder = 998;
  mesh.userData.uiId = "view";
  group.add(mesh);

  /**
   * One button, labelled with the view it is currently in.
   *
   * A two-half switch spent a third of the display's top edge saying something a
   * single word says. It also made the reader decide whether a lit half names the
   * current state or the one they would get — which a plain label never does.
   */
  const paint = (flat: boolean) => {
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);

    g.fillStyle = "rgba(14,12,24,.8)";
    g.strokeStyle = "rgba(107,255,224,.45)";
    g.lineWidth = 3;
    pill(g, w, h, h / 2);
    g.fill();
    g.stroke();

    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "800 56px ui-sans-serif, system-ui, sans-serif";
    g.fillStyle = "#6bffe0";
    g.fillText(flat ? "2D" : "3D", w / 2, h / 2 + 3);

    tex.needsUpdate = true;
  };
  paint(false);

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  return {
    group,
    layout: (fovDeg, aspect) => {
      const halfH = Math.tan((fovDeg * Math.PI) / 360) * Math.abs(Z);
      const halfW = halfH * aspect;
      mesh.position.set(-halfW + PAD + W / 2, halfH - PAD - H / 2, Z);
    },
    setFlat: paint,
    pick: (uv, camera) => {
      ndc.set(uv.x * 2 - 1, uv.y * 2 - 1);
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObject(mesh, false)[0];
      return h ? (mesh.userData.uiId as string) : null;
    },
    dispose: () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      tex.dispose();
    },
  };
}
