"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createDevice, type DeviceId } from "../lib/three/device";
import { createChartWorld, WORLD, CHART_OFFSET_X, visibleSpanOf } from "../lib/three/stage";
import { createChart, laneIntervals, type ChartData, type DrawPoint } from "../lib/three/chart";
import { bucketize, priceExtent, type Bucket } from "../lib/three/buckets";
import { GB_H, GB_W, drawGb, type MenuRow } from "../lib/gb";
import { MAIN_H, MAIN_W, drawBoard, drawControlLarge, rowAtUV } from "../lib/screen";
import { createParticles } from "../lib/three/particles";
import type { Skin } from "../lib/skins";
import type { LegView, PricePoint } from "../lib/render/types";

export type Mode = "draw" | "pixel";
export type { DeviceId };

export interface Device3DProps {
  skin: Skin;
  priceRef?: React.RefObject<PricePoint[]>;
  legsRef?: React.RefObject<LegView[]>;
  curveRef?: React.RefObject<DrawPoint[]>;
  planStartRef?: React.RefObject<number | null>;
  planId?: number | null;
  horizonSec?: number;
  legCount?: number;
  mode?: Mode;
  swapped?: boolean;
  /** True while the pencil is armed: the screen becomes a drawing surface. */
  drawArmed?: boolean;
  onStrokeEnd?: (pts: DrawPoint[]) => void;
  rows?: MenuRow[];
  cursor?: number;
  editing?: boolean;
  connected?: boolean;
  onKey?: (id: DeviceId) => void;
  onScroll?: (step: number) => void;
  enabled?: Partial<Record<DeviceId, boolean>>;
  active?: Partial<Record<DeviceId, boolean>>;
  /** How much of the frame the device fills. /play zooms in; the home page does not. */
  fill?: number;
  /** Unconstrained rotation, for the presentation layer. */
  freeOrbit?: boolean;
  idleSpin?: boolean;
  /**
   * The device is furniture: it drifts, and a drag turns the CHART inside its screen
   * rather than the machine itself. This is how the play surface behaves.
   */
  floatOnly?: boolean;
  /** Which channel the big screen is showing. */
  screen?: "chart" | "settings" | "board";
  /** A tap on the settings glass picks a row. */
  onPickRow?: (i: number) => void;
  onSelect?: () => void;
  board?: { rank: number; who: string; plans: number; hit: string; ret: string }[];
  /** Drawn inside the chart screen, and hidden when the chart is not on it. */
  plan?: { direction: "UP" | "DOWN"; stake: bigint }[];
  /** Ambient particle field behind the device, tinted by the skin. */
  particles?: boolean;
}

const BODY_W = 14.4;
const BODY_H = 8.4;
/** Radians of scroll per detent. */
const DETENT = 0.4;

/**
 * The device, rendered as one WebGL context.
 *
 * The chart is a separate scene drawn into a render target, and that target's
 * texture IS the device's main screen. Two things fall out of that: the whole page
 * costs one context instead of two, and the screen becomes a real surface — a ray
 * can hit it, which is what makes the display a touch surface you draw on.
 */
export function Device3D(props: Device3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const canvas = glRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    // ── one renderer ──────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true,
      // Kept so a share shot can read the buffer after the frame has been presented.
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // ── the chart, drawn into a target ────────────────────────────────────
    const RT_W = 1100;
    const RT_H = 980;
    const rt = new THREE.WebGLRenderTarget(RT_W, RT_H, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      colorSpace: THREE.SRGBColorSpace,
    });
    const world = createChartWorld();
    world.setAspect(RT_W / RT_H);
    const chart = createChart();
    chart.group.position.x = CHART_OFFSET_X;
    world.scene.add(chart.group);

    // ── the DMG buffer ────────────────────────────────────────────────────
    const gb = document.createElement("canvas");
    gb.width = GB_W;
    gb.height = GB_H;
    const gbCtx = gb.getContext("2d")!;
    gbCtx.imageSmoothingEnabled = false;

    /**
     * The Plan strip lives INSIDE the chart screen, parented to the chart camera so
     * it holds the bottom of the frame however the chart is turned. It is part of the
     * readout, not chrome around the device — and it disappears with the chart when
     * the displays swap.
     */
    const hudCanvas = document.createElement("canvas");
    hudCanvas.width = 1024;
    hudCanvas.height = 116;
    const hudCtx = hudCanvas.getContext("2d")!;
    const hudTex = new THREE.CanvasTexture(hudCanvas);
    hudTex.colorSpace = THREE.SRGBColorSpace;
    const hud = new THREE.Mesh(
      new THREE.PlaneGeometry(1.36, 0.154),
      new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, toneMapped: false }),
    );
    hud.position.set(0, -0.5, -2);
    hud.renderOrder = 999;
    hud.visible = false;
    world.camera.add(hud);
    world.scene.add(world.camera);

    const drawHud = (legs: { direction: "UP" | "DOWN"; stake: bigint }[]) => {
      const W = hudCanvas.width;
      const H = hudCanvas.height;
      hudCtx.clearRect(0, 0, W, H);
      hudCtx.fillStyle = "rgba(14,12,24,.86)";
      hudCtx.strokeStyle = "rgba(255,255,255,.1)";
      hudCtx.lineWidth = 2;
      hudCtx.beginPath();
      hudCtx.roundRect(2, 2, W - 4, H - 4, 26);
      hudCtx.fill();
      hudCtx.stroke();
      hudCtx.textBaseline = "middle";
      hudCtx.fillStyle = "#6b6486";
      hudCtx.font = "700 26px ui-sans-serif, system-ui, sans-serif";
      hudCtx.fillText(`PLAN · ${legs.length} LEGS`, 34, H / 2);

      // Fit the legs to the space that is left: an eight-leg Plan must not run off
      // the end of the strip, so the type shrinks rather than the list truncating.
      const startX = 300;
      const avail = W - startX - 34;
      const labels = legs.map((l) => `${l.direction === "UP" ? "▲" : "▼"} ${(Number(l.stake) / 1e6).toFixed(2)}`);
      let size = 30;
      let gap = 30;
      const widthAt = (px: number, g: number) => {
        hudCtx.font = `700 ${px}px ui-sans-serif, system-ui, sans-serif`;
        return labels.reduce((sum, t) => sum + hudCtx.measureText(t).width + g, -g);
      };
      while (size > 17 && widthAt(size, gap) > avail) { size -= 1; gap = Math.max(14, gap - 1); }

      let x = startX;
      hudCtx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
      legs.forEach((l, i) => {
        hudCtx.fillStyle = l.direction === "UP" ? "#6bffc4" : "#ff6a7a";
        hudCtx.fillText(labels[i], x, H / 2);
        x += hudCtx.measureText(labels[i]).width + gap;
      });
      hudTex.needsUpdate = true;
    };
    let hudKey = "";

    // The settings surface, for when it takes the big screen.
    const panel = document.createElement("canvas");
    panel.width = MAIN_W;
    panel.height = MAIN_H;
    const panelCtx = panel.getContext("2d")!;
    const panelTex = new THREE.CanvasTexture(panel);
    panelTex.colorSpace = THREE.SRGBColorSpace;

    // ── the device ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    const device = createDevice(live.current.skin, rt.texture, gb);
    const pivot = new THREE.Group();
    pivot.add(device.root);
    scene.add(pivot);

    const key = new THREE.DirectionalLight(0xfff1da, 2.98);
    key.position.set(-9, 12, 21);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.radius = 4;
    key.shadow.bias = -5e-4;
    key.shadow.normalBias = 0.1;
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -12; sc.right = 12; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60;
    // `position` on an Object3D is read-only; it must be set, never assigned.
    const fill = new THREE.DirectionalLight(0xffe9cf, 0.69);
    fill.position.set(12, 2, 14);
    scene.add(key, fill,
      new THREE.HemisphereLight(0xfffce0, 0xcdbbd8, 1.73),
      new THREE.AmbientLight(0xffffff, 0.5));

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.32 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -BODY_H / 2 - 1.2;
    floor.receiveShadow = true;
    scene.add(floor);

    const field = createParticles(live.current.skin);
    field.points.visible = !!live.current.particles;
    scene.add(field.points);

    const resize = () => {
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const frac = live.current.fill ?? 0.86;
      const byW = BODY_W / (frac * 2 * Math.tan(halfFov) * camera.aspect);
      const byH = BODY_H / (frac * 2 * Math.tan(halfFov));
      camera.position.set(0, 0.25, Math.max(byW, byH));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── lane cache ────────────────────────────────────────────────────────
    let lanes: Bucket[][] = [[], [], [], []];
    let ivs = laneIntervals(live.current.horizonSec ?? 360);
    let extent = { lo: 0, hi: 1 };
    let laneKey = "";
    const refreshLanes = (price: PricePoint[], now: number, horizon: number) => {
      const k = `${price.length}:${price.at(-1)?.t ?? 0}:${horizon}`;
      if (k === laneKey) return;
      laneKey = k;
      ivs = laneIntervals(horizon);
      lanes = ivs.map((iv) => bucketize(price, iv, now - visibleSpanOf(horizon) * (1 - WORLD.futureFraction)));
      extent = priceExtent(lanes);
    };

    // ── pointer ───────────────────────────────────────────────────────────
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let orbiting: { x: number; y: number } | null = null;
    let held: DeviceId | null = null;
    let rolling: { y: number; acc: number } | null = null;
    let drawing = false;
    let chartOrbit: { x: number; y: number } | null = null;
    /** Once the user has turned it themselves, the idle drift stops fighting them. */
    let touched = false;

    const hit = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObjects([device.mainScreen, ...device.targets], true)[0] ?? null;
    };
    const idOf = (h: THREE.Intersection | null) => {
      if (!h) return null;
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.deviceId && !o.userData.touch) o = o.parent;
      if (!o) return null;
      return o.userData.touch ? "screen" : (o.userData.deviceId as string);
    };

    /**
     * A hit on the glass becomes a point in the chart's drawable span.
     *
     * The screen's UV is the render target's frame, so the drawable region has to be
     * projected through the CHART camera — not the device camera — and normalised
     * inside that frame. This is the whole touch path; getting the camera wrong here
     * silently puts every stroke in the wrong place.
     */
    const screenToCurve = (h: THREE.Intersection): DrawPoint | null => {
      if (!h.uv) return null;
      const v3 = new THREE.Vector3();
      const project = (x: number, y: number) => {
        v3.set(x, y, 0);
        chart.group.localToWorld(v3);
        v3.project(world.camera);
        return { x: (v3.x + 1) / 2, y: (v3.y + 1) / 2 };
      };
      const r = chart.drawRect();
      const a = project(r.x0, r.y1);
      const b = project(r.x1, r.y0);
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      const bottom = Math.min(a.y, b.y);
      const top = Math.max(a.y, b.y);
      const u = (h.uv.x - left) / Math.max(right - left, 1e-6);
      const v = (h.uv.y - bottom) / Math.max(top - bottom, 1e-6);
      return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
    };

    const onDown = (e: PointerEvent) => {
      const h = hit(e);
      const id = idOf(h);
      canvas.setPointerCapture(e.pointerId);
      if (id === "screen" && live.current.drawArmed && h) {
        drawing = true;
        const c = live.current.curveRef?.current;
        if (c) { c.length = 0; const p = screenToCurve(h); if (p) c.push(p); }
        return;
      }
      // A tap on the settings glass picks the row under it.
      if (id === "screen" && h?.uv && live.current.screen === "settings") {
        const i = rowAtUV(h.uv.y, live.current.rows?.length ?? 0);
        if (i >= 0) { live.current.onPickRow?.(i); return; }
      }
      // Dragging the chart glass turns the CHART, not the device.
      if (id === "screen" && live.current.screen === "chart" && !live.current.freeOrbit) {
        chartOrbit = { x: e.clientX, y: e.clientY };
        return;
      }
      if (id === "bet") { rolling = { y: e.clientY, acc: 0 }; return; }
      if (id && id !== "screen" && live.current.enabled?.[id as DeviceId] !== false) {
        held = id as DeviceId;
        device.setPressed(held);
        return;
      }
      if (!live.current.floatOnly) { orbiting = { x: e.clientX, y: e.clientY }; touched = true; }
    };

    const onMove = (e: PointerEvent) => {
      if (drawing) {
        const h = hit(e);
        if (idOf(h) !== "screen" || !h) return;
        const p = screenToCurve(h);
        if (p) live.current.curveRef?.current?.push(p);
        return;
      }
      if (chartOrbit) {
        world.orbitBy((chartOrbit.x - e.clientX) * 0.006, (e.clientY - chartOrbit.y) * 0.0045);
        chartOrbit = { x: e.clientX, y: e.clientY };
        return;
      }
      if (rolling) {
        const dy = (rolling.y - e.clientY) * 0.012;
        rolling.y = e.clientY;
        rolling.acc += dy;
        device.spinBet(-dy);
        while (Math.abs(rolling.acc) >= DETENT) {
          const step = rolling.acc > 0 ? -1 : 1;
          rolling.acc += step * DETENT;
          live.current.onScroll?.(step);
        }
        return;
      }
      if (!orbiting) return;
      const free = live.current.freeOrbit;
      pivot.rotation.y = free
        ? pivot.rotation.y - (orbiting.x - e.clientX) * 0.007
        : THREE.MathUtils.clamp(pivot.rotation.y - (orbiting.x - e.clientX) * 0.006, -0.95, 0.95);
      pivot.rotation.x = free
        ? pivot.rotation.x - (orbiting.y - e.clientY) * 0.006
        : THREE.MathUtils.clamp(pivot.rotation.x - (orbiting.y - e.clientY) * 0.005, -0.6, 0.6);
      if (!live.current.floatOnly) { orbiting = { x: e.clientX, y: e.clientY }; touched = true; }
    };

    const onUp = (e: PointerEvent) => {
      if (drawing) {
        drawing = false;
        live.current.onStrokeEnd?.([...(live.current.curveRef?.current ?? [])]);
      }
      if (held) {
        if (idOf(hit(e)) === held) live.current.onKey?.(held);
        device.setPressed(null);
        held = null;
      }
      orbiting = null;
      rolling = null;
      chartOrbit = null;
    };

    /**
     * On a machine with a keyboard, the console's keys map to it. Touch-only devices
     * get nothing bound, so the hint is never shown where it cannot be used.
     */
    const hasKeyboard = window.matchMedia("(pointer: fine)").matches;
    const KEYS: Record<string, DeviceId | "scrollUp" | "scrollDown"> = {
      ArrowUp: "scrollUp", ArrowDown: "scrollDown",
      w: "scrollUp", s: "scrollDown",
      Enter: "authorise", " ": "authorise",
      ArrowLeft: "cancel", a: "cancel",
      ArrowRight: "board", d: "board",
      n: "new", e: "draw", q: "swap", m: "mode",
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      const act = KEYS[ev.key];
      if (!act) return;
      ev.preventDefault();
      if (act === "scrollUp") { live.current.onScroll?.(-1); return; }
      if (act === "scrollDown") { live.current.onScroll?.(1); return; }
      if (live.current.enabled?.[act] === false) return;
      device.setPressed(act);
      window.setTimeout(() => device.setPressed(null), 130);
      live.current.onKey?.(act);
    };
    if (hasKeyboard) window.addEventListener("keydown", onKeyDown);

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    // ── frame ─────────────────────────────────────────────────────────────
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    let frameNo = 0;
    let flatten = 0;
    let gbKey = "";
    let skinKey = live.current.skin.key;
    let wasChannel: "chart" | "settings" | "board" = "chart";

    const tick = () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      frameNo++;
      const p = live.current;
      const elapsed = (now - t0) / 1000;

      if (p.skin.key !== skinKey) {
        // In place — rebuilding the scene here drops a frame budget and resets the
        // camera the user just aimed.
        skinKey = p.skin.key;
        device.applySkin(p.skin);
        field.applySkin(p.skin);
      }
      field.points.visible = !!p.particles;
      if (p.particles) field.update(dt, elapsed);

      // Swap exchanges what each screen carries: the settings panel takes the big
      // display, and the chart drops to the DMG in its four tones.
      const channel = p.screen ?? "chart";
      if (channel !== wasChannel) {
        wasChannel = channel;
        device.setMainTexture(channel === "chart" ? rt.texture : panelTex);
      }
      if (channel === "settings") {
        drawControlLarge(panelCtx, p.rows ?? [], p.cursor ?? 0, !!p.editing, !!p.connected, p.skin, elapsed);
        panelTex.needsUpdate = true;
      } else if (channel === "board") {
        drawBoard(panelCtx, p.board ?? [], p.skin);
        panelTex.needsUpdate = true;
      }

      // The strip belongs to the chart: it goes when the chart goes.
      const plan = p.plan ?? [];
      hud.visible = channel === "chart" && plan.length > 0;
      const hk = plan.map((l) => `${l.direction}${l.stake}`).join(",");
      if (hud.visible && hk !== hudKey) { hudKey = hk; drawHud(plan); }

      // The DMG panel is TEXT: redraw only when something on it actually changed.
      // Re-uploading a 320x288 texture every frame for a static panel is pure waste.
      const legs = p.legsRef?.current ?? [];
      const k = `${channel}|${p.cursor}|${p.editing}|${p.connected}|${p.mode}|${p.planId}|${p.legCount}|` +
        (p.rows ?? []).map((r) => r.value).join(",") + "|" + legs.map((l) => l.state).join(",") +
        "|" + (p.swapped || legs.some((l) => l.state === "open") || p.planId === null ? frameNo % 20 : 0);
      if (k !== gbKey) {
        gbKey = k;
        drawGb(gbCtx, {
          showChart: channel !== "chart",
          points: p.priceRef?.current ?? [],
          legs,
          planId: p.planId ?? null,
          legCount: p.legCount ?? 6,
          mode: p.mode ?? "draw",
          frameNo,
          rows: p.rows ?? [],
          cursor: p.cursor ?? 0,
          editing: !!p.editing,
          connected: !!p.connected,
        });
        device.markScreenDirty();
      }

      // Chart.
      const nowSec = Date.now() / 1000;
      const horizon = p.horizonSec ?? 360;
      refreshLanes(p.priceRef?.current ?? [], nowSec, horizon);
      flatten += ((p.drawArmed ? 1 : 0) - flatten) * Math.min(1, dt * 3.4);
      world.setFlatten(flatten);
      const data: ChartData = {
        lanes, laneIntervals: ivs, extent, now: nowSec, horizonSec: horizon,
        legs, curve: p.curveRef?.current?.length ? p.curveRef.current : null,
        planStart: p.planStartRef?.current ?? null,
      };
      chart.update(data, elapsed);

      for (const id of ["authorise", "draw", "board", "cancel", "new", "swap", "mode"] as DeviceId[]) {
        device.setEnabled(id, p.enabled?.[id] !== false);
        device.setActive(id, p.active?.[id] === true);
      }
      device.update(dt, elapsed);

      if (p.floatOnly) {
        // Furniture, not a toy: a slow drift on two axes plus a shallow bob. Small
        // enough that a control never moves out from under the pointer.
        pivot.rotation.y = Math.sin(elapsed * 0.21) * 0.05;
        pivot.rotation.x = Math.sin(elapsed * 0.17 + 1.1) * 0.028;
        pivot.position.y = Math.sin(elapsed * 0.44) * 0.12;
      } else if (p.idleSpin && !touched && !orbiting && !rolling && !held && !drawing) {
        pivot.rotation.y += (Math.sin(elapsed / 5.2) * 0.09 - pivot.rotation.y) * Math.min(1, dt * 0.5);
      }

      renderer.setRenderTarget(rt);
      renderer.render(world.scene, world.camera);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      hudTex.dispose();
      hud.geometry.dispose();
      (hud.material as THREE.Material).dispose();
      panelTex.dispose();
      field.dispose();
      device.dispose();
      world.dispose();
      rt.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
    };
    // Mounted once. The skin is applied in place, so it is NOT a dependency —
    // that is the whole point of `applySkin`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className="dev3d">
      <canvas ref={glRef} className="dev3d-gl" />
    </div>
  );
}
