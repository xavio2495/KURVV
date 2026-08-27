"use client";
import { useCallback, useEffect, useRef } from "react";
import { makeViewport } from "../lib/render/viewport";
import { renderPrice } from "../lib/render/price";
import { renderCurve, type DrawnPoint } from "../lib/render/curve";
import { renderLegs } from "../lib/render/legs";
import { renderCursor, type CursorState } from "../lib/render/cursor";
import { AXIS_H, AXIS_W, type Dims, type LegView, type PricePoint } from "../lib/render/types";

interface Props {
  priceRef: React.RefObject<PricePoint[]>;
  legsRef: React.RefObject<LegView[]>;
  drawnRef: React.RefObject<DrawnPoint[]>;
  horizonSec: number;
  drawingEnabled: boolean;
  onStrokeEnd: (pts: DrawnPoint[]) => void;
}

/**
 * One rAF loop, layers drawn back to front, and every mutable value in a REF.
 *
 * A streaming price feed in React state re-renders the tree on every tick and the
 * frame budget is gone. Nothing here reads component state inside the loop.
 */
export function Canvas({ priceRef, legsRef, drawnRef, horizonSec, drawingEnabled, onStrokeEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dimsRef = useRef<Dims>({ w: 900, h: 420, dpr: 1 });
  const cursorRef = useRef<CursorState>({ x: 0, y: 0, inside: false });
  const drawingRef = useRef(false);
  const rafRef = useRef(0);

  const resize = useCallback(() => {
    const c = canvasRef.current, wrap = wrapRef.current;
    if (!c || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    dimsRef.current = { w, h, dpr };
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }, []);

  useEffect(() => {
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [resize]);

  useEffect(() => {
    const tick = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        const d = dimsRef.current;
        ctx.setTransform(d.dpr, 0, 0, d.dpr, 0, 0);
        ctx.clearRect(0, 0, d.w, d.h);
        ctx.fillStyle = "#0b0d10";
        ctx.fillRect(0, 0, d.w, d.h);

        const vp = makeViewport(d, priceRef.current ?? [], horizonSec);
        renderLegs(ctx, vp, legsRef.current ?? []);          // behind everything
        renderPrice(ctx, d, vp, priceRef.current ?? []);
        renderCurve(ctx, vp, drawnRef.current ?? [], drawingRef.current);
        renderCursor(ctx, vp, cursorRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [priceRef, legsRef, drawnRef, horizonSec]);

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent) => {
    if (!drawingEnabled) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    drawnRef.current!.length = 0;
    drawnRef.current!.push(local(e));
  };
  const move = (e: React.PointerEvent) => {
    const p = local(e);
    cursorRef.current = { ...p, inside: p.x < dimsRef.current.w - AXIS_W && p.y < dimsRef.current.h - AXIS_H };
    if (drawingRef.current) drawnRef.current!.push(p);
  };
  const up = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onStrokeEnd([...(drawnRef.current ?? [])]);
  };

  return (
    <div ref={wrapRef} className="canvasWrap">
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={() => { cursorRef.current.inside = false; up(); }}
        style={{ cursor: drawingEnabled ? "crosshair" : "default", touchAction: "none", display: "block" }}
      />
    </div>
  );
}
