"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createDevice, DEVICE_IDS, type DeviceId } from "../lib/three/device";
import type { IconName } from "../lib/three/icons";

import {
  FUTURE_FRACTION, bucketize, priceExtent, timelineInterval, visibleSpanOf, type Bucket,
} from "../lib/three/buckets";
import { GB_H, GB_W, drawGb, type MenuRow } from "../lib/gb";
import { sfx } from "../lib/sfx";
import { cellAt, type PixelCells } from "../lib/pixel";
import type { FlappyView } from "../lib/flappy";
import { createFlappyScene } from "../lib/flappyScene";
import { createChartScene, uvToPlot } from "../lib/chartScene";

/** Curves kept on the chart at once. Beyond this the oldest is dropped. */
const MAX_CURVES = 6;

/**
 * What each key's cap says, given what it currently does.
 *
 * These controls are genuinely contextual — the bottom key draws a Curve, paints a
 * grid or dives a bird; the top key is the trader's channel until a flight is up,
 * when it becomes the climb; the centre key selects a row on a list and commits a
 * Plan on a chart. A fixed set of glyphs made three of those five meanings
 * unguessable, and a legend the user has to learn is the thing a moulded cap exists
 * to avoid.
 */
function glyphsFor(
  mode: Mode,
  screen: NonNullable<Device3DProps["screen"]>,
  flying: boolean,
): Partial<Record<DeviceId, IconName>> {
  return {
    draw: flying ? "down" : mode === "pixel" ? "grid" : mode === "flappy" ? "bird" : "pen",
    profile: flying ? "up" : "person",
    // The mode key is a "go to" key, so it shows the mode it goes TO. Showing the
    // current mode would make it the only control on the device that says where you
    // already are rather than what pressing it does.
    mode: mode === "draw" ? "grid" : mode === "pixel" ? "bird" : "pen",
    authorise: screen === "settings" ? "check" : "bolt",
  };
}

/** The chart channel is the only surface a Curve or a grid may be painted on. */
const onChart = (p: Device3DProps) => (p.screen ?? "chart") === "chart" && p.mode !== "flappy";
import {
  MAIN_H, MAIN_W, drawAutonomy, drawBoard, drawControlLarge, optionAtUV, rowAtUV, type FireRow,
} from "../lib/screen";
import { createParticles } from "../lib/three/particles";
import { skinIndex, type Skin } from "../lib/skins";
import type { DrawPoint, LegView, PricePoint } from "../lib/render/types";

export type Mode = "draw" | "pixel" | "flappy";
export type { DeviceId };

export interface Device3DProps {
  skin: Skin;
  priceRef?: React.RefObject<PricePoint[]>;
  legsRef?: React.RefObject<LegView[]>;
  /** Every drawn Curve, oldest first. The last is the active one. */
  curveRef?: React.RefObject<DrawPoint[][]>;
  /** Pixel mode's painted grid. Written in place, like the Curve. */
  cellsRef?: React.RefObject<PixelCells>;
  /** Flappy mode's gates and flight, already normalised. */
  gates?: FlappyView | null;
  /** The venue publishes no reference level, so the run cannot be anchored. */
  flappyUnsupported?: boolean;
  /** How the rehearsal did, for the strip and the panel. */
  score?: { hit: number; resolved: number; placed: number } | null;
  planStartRef?: React.RefObject<number | null>;
  planId?: number | null;
  horizonSec?: number;
  /** The asset on the feed, for the panel's own label. */
  asset?: string;
  legCount?: number;
  mode?: Mode;
  /** True while the pencil is armed: the screen becomes a drawing surface. */
  drawArmed?: boolean;
  onStrokeEnd?: () => void;
  rows?: MenuRow[];
  cursor?: number;
  editing?: boolean;
  connected?: boolean;
  /** What to call the active signer — "Email wallet", "Metamask", "Demo signer". */
  walletLabel?: string;
  onKey?: (id: DeviceId) => void;
  /**
   * Set only while a flappy run is sweeping. It takes over the top and bottom keys,
   * so the run has an input without any control changing what it means elsewhere.
   */
  onFlap?: ((up: boolean) => void) | null;
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
  screen?: "chart" | "settings" | "board" | "autonomy";
  /** A tap on the settings glass picks a row, or an option from its dropdown. */
  onPickRow?: (i: number) => void;
  onPickOption?: (row: number, option: number) => void;
  /** The dropdown currently open on the settings panel. */
  open?: { row: number; options: readonly string[]; selected: number } | null;
  onSelect?: () => void;
  board?: { rank: number; who: string; plans: number; hit: string; ret: string; you?: boolean }[];
  /** True when the standings are illustrative, so the panel can say so. */
  boardSample?: boolean;
  /** The Reactivity fire feed — the proof that nobody signed the Legs. */
  fires?: FireRow[];
  fireState?: { scanning: boolean; error: string | null; hasPlan: boolean; nextOpenSec: number | null };
  /** Drawn inside the chart screen, and hidden when the chart is not on it. */
  plan?: { direction: "UP" | "DOWN"; stake: bigint }[];
  /** Ambient particle field behind the device, tinted by the skin. */
  particles?: boolean;
  /** Whether the selected venue has an open Window. `null` while unknown. */
  venueLive?: boolean | null;
  /** Wallet balance and committed stake, for the play readout on the second screen. */
  balance?: bigint | null;
  stake?: bigint;
  /**
   * Where the roller currently sits in its run, and how long that run is. The detent
   * click is pitched from this, so the ear knows which end of the range it is at.
   */
  rollerStep?: number;
  rollerSpan?: number;
}

const BODY_W = 14.4;
const BODY_H = 8.4;
/** Radians of scroll per detent. */
const DETENT = 0.4;

/**
 * The device, rendered as one WebGL context.
 *
 * WebGL draws exactly one thing here: the machine itself. Every SCREEN it shows —
 * chart, grid, flappy, settings, standings, autonomy — is a 2D canvas uploaded as
 * one texture. Two things fall out of that: the whole page costs one context, and
 * the display is a real surface a ray can hit, which is what makes it a touch
 * surface you draw on.
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

    /**
     * There is no render target and no chart scene any more.
     *
     * Every screen the device shows is a 2D canvas: chart, grid, flappy, settings,
     * standings, autonomy. The WebGL context now draws exactly one thing — the
     * device itself — and the display is a texture uploaded from a canvas.
     */

    // ── the DMG buffer ────────────────────────────────────────────────────
    const gb = document.createElement("canvas");
    gb.width = GB_W;
    gb.height = GB_H;
    const gbCtx = gb.getContext("2d")!;
    gbCtx.imageSmoothingEnabled = false;


    // The settings surface, for when it takes the big screen.
    const panel = document.createElement("canvas");
    panel.width = MAIN_W;
    panel.height = MAIN_H;
    const panelCtx = panel.getContext("2d")!;
    const panelTex = new THREE.CanvasTexture(panel);
    panelTex.colorSpace = THREE.SRGBColorSpace;
    /** Both game scenes draw into the same panel canvas; the screen is only ever it. */
    const flappy = createFlappyScene();
    const chartScene = createChartScene();

    // ── the device ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    const device = createDevice(live.current.skin, panelTex, gb);
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
      // On a narrow frame the device has to take the whole width or its controls
      // become too small to hit; the caller's fill is a desktop preference.
      const narrow = w < 760;
      const frac = narrow ? 0.99 : (live.current.fill ?? 0.86);
      const byW = BODY_W / (frac * 2 * Math.tan(halfFov) * camera.aspect);
      const byH = BODY_H / (frac * 2 * Math.tan(halfFov));
      // Portrait: bias to width, and let the body sit higher so the HUD has room.
      const portrait = h > w;
      camera.position.set(0, portrait ? 0.1 : 0.25, portrait ? byW : Math.max(byW, byH));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── lane cache ────────────────────────────────────────────────────────
    let buckets: Bucket[] = [];
    let interval = timelineInterval(live.current.horizonSec ?? 360);
    let extent = { lo: 0, hi: 1 };
    let seriesKey = "";
    const refreshSeries = (price: PricePoint[], now: number, horizon: number) => {
      const k = `${price.length}:${price.at(-1)?.t ?? 0}:${horizon}`;
      if (k === seriesKey) return;
      seriesKey = k;
      interval = timelineInterval(horizon);
      // The plot devotes its left side to history; PLOT.x0 is the split, so the visible
      // history span is that same fraction of the window.
      buckets = bucketize(price, interval, now - visibleSpanOf(horizon) * (1 - FUTURE_FRACTION));
      extent = priceExtent([buckets]);
    };

    // ── pointer ───────────────────────────────────────────────────────────
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let orbiting: { x: number; y: number } | null = null;
    let held: DeviceId | null = null;
    let rolling: { y: number; acc: number } | null = null;
    let drawing = false;
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
     * A hit on the glass becomes a point in the drawable span.
     *
     * The canvas IS the screen now, so this is two divisions against a rect both the
     * renderer and the hit test import from one place. It used to project that rect
     * through the chart camera, and using the device camera by mistake put every
     * stroke somewhere the user had not drawn.
     */
    const screenToCurve = (h: THREE.Intersection): DrawPoint | null => {
      if (!h.uv) return null;
      return uvToPlot(h.uv.x, h.uv.y);
    };

    /**
     * Paint one column of the grid.
     *
     * A drag sets each column it crosses to the row under the pointer, so sweeping
     * left to right draws a silhouette in one gesture — the same motion as drawing a
     * Curve, quantised. Only the column under the finger changes, so dragging back
     * over a column corrects it rather than adding to it.
     */
    const paintAt = (h: THREE.Intersection) => {
      const cells = live.current.cellsRef?.current;
      const p = screenToCurve(h);
      if (!cells || !p) return;
      const { col, row } = cellAt(p.u, p.v, live.current.legCount ?? 6);
      if (col < cells.length) cells[col] = row;
    };

    const onDown = (e: PointerEvent) => {
      // The audio context can only be opened inside a gesture, so the first touch
      // anywhere on the device is what makes the rest of the session audible.
      sfx.unlock();
      const h = hit(e);
      const id = idOf(h);
      canvas.setPointerCapture(e.pointerId);
      if (id === "screen" && h?.uv && live.current.onFlap) {
        // Upper half is up, lower half is down. The one gesture a phone can make.
        const up = h.uv.y >= 0.5;
        const key: DeviceId = up ? "profile" : "draw";
        device.setPressed(key);
        sfx.press(key);
        window.setTimeout(() => { device.setPressed(null); sfx.release(key); }, 110);
        live.current.onFlap(up);
        return;
      }
      // ONLY on the chart. The pencil now stays armed from one gesture to the next,
      // so a check that omitted the channel would turn a tap on the settings list —
      // or the standings, or the fire feed — into a stroke on a chart nobody can see.
      if (id === "screen" && live.current.drawArmed && onChart(live.current) && h) {
        drawing = true;
        if (live.current.mode === "pixel") { paintAt(h); return; }
        const all = live.current.curveRef?.current;
        if (all) {
          // Append. Clearing here is what made every new stroke erase the last one.
          const p = screenToCurve(h);
          all.push(p ? [p] : []);
          if (all.length > MAX_CURVES) all.shift();
        }
        return;
      }
      // A tap on the settings glass. An open dropdown gets first refusal, or a tap
      // meant for an option would fall through and re-pick the row behind it.
      if (id === "screen" && h?.uv && live.current.screen === "settings") {
        const open = live.current.open;
        if (open) {
          const o = optionAtUV(h.uv.y, open.row, open.options.length);
          sfx.tap();
          live.current.onPickOption?.(open.row, o);   // -1 closes without choosing
          return;
        }
        const i = rowAtUV(h.uv.y, live.current.rows?.length ?? 0);
        if (i >= 0) { sfx.tap(); live.current.onPickRow?.(i); return; }
      }
      if (id === "bet") { rolling = { y: e.clientY, acc: 0 }; return; }
      if (id && id !== "screen") {
        // A refused key still answers, and answers differently. Silence here reads
        // as a broken button rather than a disabled one.
        if (live.current.enabled?.[id as DeviceId] === false) { sfx.disabled(); return; }
        held = id as DeviceId;
        device.setPressed(held);
        sfx.press(held);
        return;
      }
      if (!live.current.floatOnly) { orbiting = { x: e.clientX, y: e.clientY }; touched = true; }
    };

    const onMove = (e: PointerEvent) => {
      if (drawing) {
        const h = hit(e);
        if (idOf(h) !== "screen" || !h) return;
        if (live.current.mode === "pixel") { paintAt(h); return; }
        const p = screenToCurve(h);
        const all = live.current.curveRef?.current;
        if (p && all?.length) all[all.length - 1].push(p);
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
          if (live.current.onFlap) { live.current.onFlap(step < 0); continue; }
          sfx.detent(live.current.rollerStep ?? 0, live.current.rollerSpan ?? 8);
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
        sfx.stroke();
        // A tap that produced no line leaves an empty Curve behind; drop it.
        const all = live.current.curveRef?.current;
        if (all?.length && all[all.length - 1].length < 2) all.pop();
        live.current.onStrokeEnd?.();
      }
      if (held) {
        if (idOf(hit(e)) === held) {
          sfx.release(held);
          if (live.current.onFlap && (held === "profile" || held === "draw")) live.current.onFlap(held === "profile");
          else live.current.onKey?.(held);
        }
        device.setPressed(null);
        held = null;
      }
      orbiting = null;
      rolling = null;
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
      ArrowRight: "asset", d: "asset",
      p: "profile", e: "draw", q: "swap", m: "mode",
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      const act = KEYS[ev.key];
      if (!act) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      // Space and Enter belong to whatever control has focus. Without this the
      // handler swallows them everywhere — tabbing to Share, Sound or Install and
      // pressing either cancels the button and routes the press to the centre key,
      // which is the commit. A shortcut must never send a transaction on behalf of a
      // button the user was actually aiming at.
      //
      // Scoped to those two keys ON PURPOSE. Blocking every binding whenever focus is
      // off `document.body` looks tidier and is worse: a browser focuses a <button>
      // when you click it, so one click on Sound would leave the whole device
      // keyboard-dead until the user thought to click the canvas again.
      const t = ev.target as HTMLElement | null;
      const focusTakesKey = !!t && (
        t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(t.tagName)
      );
      if (focusTakesKey && (ev.key === " " || ev.key === "Enter")) return;
      ev.preventDefault();
      const flap = live.current.onFlap;
      if (flap && (act === "scrollUp" || act === "scrollDown" || act === "profile" || act === "draw")) {
        const up = act === "scrollUp" || act === "profile";
        const key: DeviceId = up ? "profile" : "draw";
        device.setPressed(key);
        sfx.press(key);
        window.setTimeout(() => { device.setPressed(null); sfx.release(key); }, 110);
        flap(up);
        return;
      }
      if (act === "scrollUp" || act === "scrollDown") {
        sfx.detent(live.current.rollerStep ?? 0, live.current.rollerSpan ?? 8);
        live.current.onScroll?.(act === "scrollUp" ? -1 : 1);
        return;
      }
      if (live.current.enabled?.[act] === false) { sfx.disabled(); return; }
      device.setPressed(act);
      sfx.press(act);
      window.setTimeout(() => { device.setPressed(null); sfx.release(act); }, 130);
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
    let gbKey = "";
    let glyphsKey = "";
    let skinKey = live.current.skin.key;

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
      //
      // Flappy is a MODE, not a channel, but it owns the whole display while it is
      // on: the game is 2D pixel art and drawing it as geometry inside an orbiting
      // perspective chart was the reason it never read. So it takes over whenever
      // the chart would otherwise be up, and every other channel still wins.
      // What the live gesture has bet, and how much of it the chain sent itself.
      // Read BEFORE the channel branches: every one of them shows one or the other.
      const plan = p.plan ?? [];
      const synthetic = (p.fires ?? []).filter((f) => f.synthetic).length;
      const base = p.screen ?? "chart";
      const channel = base === "chart" && p.mode === "flappy" ? "flappy" : base;
      if (channel === "settings") {
        drawControlLarge(panelCtx, p.rows ?? [], p.cursor ?? 0, !!p.editing, !!p.connected, p.skin,
          elapsed, p.walletLabel ?? "", p.open ?? null);
        panelTex.needsUpdate = true;
      } else if (channel === "board") {
        drawBoard(panelCtx, p.board ?? [], p.skin, !!p.boardSample);
        panelTex.needsUpdate = true;
      } else if (channel === "autonomy") {
        drawAutonomy(panelCtx, p.fires ?? [], p.skin,
          p.fireState ?? { scanning: false, error: null, hasPlan: false, nextOpenSec: null });
        panelTex.needsUpdate = true;
      } else if (channel === "flappy") {
        // Redrawn every frame on purpose: this one is animated — parallax, wingbeat
        // and a sweeping carriage — so there is no static state to key off.
        flappy.draw(panelCtx, {
          view: p.gates ?? null,
          unsupported: !!p.flappyUnsupported,
          // The mode's NAME lives on the second display now, so this says only the
          // one thing the picture cannot: how to play it. And only until the player
          // has \u2014 a permanent instruction over a live game is a permanent obstacle.
          label: p.flappyUnsupported
            ? "NO REFERENCE \u00b7 TRY 60s OR 5m"
            : plan.length ? "" : "TAP TOP OR BOTTOM",
          birdVariant: skinIndex(p.skin.key),
          skyVariant: 4,
        }, elapsed);
        panelTex.needsUpdate = true;
      }


      // The DMG panel is TEXT: redraw only when something on it actually changed.
      // Re-uploading a 320x288 texture every frame for a static panel is pure waste.
      const legs = p.legsRef?.current ?? [];
      const drawn = p.curveRef?.current ?? [];
      const drawnKey = drawn.map((c) => c.length).join(".");
      // With the chart on this panel the feed and the Curve are what move, so the
      // panel has to tick; with the control page on it, nothing does unless a value
      // changed. Both cases are the same key, read differently.
      const live2d = channel !== "chart";
      const k = `${channel}|${p.cursor}|${p.editing}|${p.connected}|${p.walletLabel}|${p.mode}|${p.planId}|${p.legCount}|` +
        (p.rows ?? []).map((r) => r.value).join(",") + "|" + legs.map((l) => l.state).join(",") +
        `|${p.open ? `${p.open.row}:${p.open.selected}` : "-"}` +
        `|${drawnKey}|${p.venueLive}|${p.fires?.length ?? 0}|${p.balance}|${p.stake}` +
        // The bets are what this panel is now mostly FOR, so a change in them has to
        // reach the redraw key or the picture freezes on the previous gesture.
        `|${plan.map((l) => `${l.direction}${l.stake}`).join(",")}|${p.score?.placed ?? 0}` +
        "|" + (live2d || legs.some((l) => l.state === "open") || p.planId === null ? frameNo % 20 : 0);
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
          asset: p.asset,
          playing: channel === "chart",
          score: p.mode === "flappy" ? (p.score ?? null) : null,
          balance: p.balance ?? null,
          stake: p.stake,
          venueLive: p.venueLive ?? null,
          plan,
        });
        device.markScreenDirty();
      }

      // The chart screen, drawn 2D like every other channel.
      if (channel === "chart") {
        const nowSec = Date.now() / 1000;
        const horizon = p.horizonSec ?? 360;
        refreshSeries(p.priceRef?.current ?? [], nowSec, horizon);
        chartScene.draw(panelCtx, {
          buckets, extent, now: nowSec, horizonSec: horizon,
          legs, planStart: p.planStartRef?.current ?? null,
          curves: p.curveRef?.current?.length ? p.curveRef.current : null,
          cells: p.mode === "pixel" ? (p.cellsRef?.current ?? null) : null,
          legCount: p.legCount ?? 6,
          season: skinIndex(p.skin.key),
          plan, synthetic,
        }, elapsed);
        panelTex.needsUpdate = true;
      }

      // Every live key, and only live keys. This list had drifted: "board" and "new"
      // are gone from the union and the `as DeviceId[]` cast was hiding it, while
      // "asset" and "profile" were missing — so those two never had `enabled`/`active`
      // re-asserted and rendered correctly only because an unset key falls through to
      // "live". State that is never re-asserted is exactly the trap this file keeps
      // hitting, so the list is now derived from the union rather than retyped.
      for (const id of DEVICE_IDS) {
        device.setEnabled(id, p.enabled?.[id] !== false);
        device.setActive(id, p.active?.[id] === true);
      }

      // Repaint a cap only when its meaning actually changed. `setGlyph` rasterises
      // a fresh 128px texture and uploads it, so doing this per frame would burn a
      // texture upload per key per frame for a picture that never moves.
      const glyphKey = `${p.mode}|${base}|${!!p.onFlap}`;
      if (glyphKey !== glyphsKey) {
        glyphsKey = glyphKey;
        const want = glyphsFor(p.mode ?? "draw", base, !!p.onFlap);
        for (const [id, icon] of Object.entries(want)) device.setGlyph(id as DeviceId, icon);
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
      flappy.dispose();
      chartScene.dispose();
      panelTex.dispose();
      field.dispose();
      device.dispose();
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
