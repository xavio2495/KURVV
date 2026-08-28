"use client";
import { useEffect, useState } from "react";
import { Device3D, type DeviceId } from "./Device3D";
import { useDeviceMenu, DEFAULTS } from "../lib/useDeviceMenu";
import { skinByKey } from "../lib/skins";
import type { DrawPoint } from "../lib/three/chart";
import type { LegView, PricePoint } from "../lib/render/types";

interface Props {
  /** How much of the frame the device fills. */
  fill?: number;
  freeOrbit?: boolean;
  /** The device drifts and never takes a grab; the chart inside it does. */
  floatOnly?: boolean;
  idleSpin?: boolean;
  particles?: boolean;
  priceRef?: React.RefObject<PricePoint[]>;
  legsRef?: React.RefObject<LegView[]>;
  curveRef?: React.RefObject<DrawPoint[]>;
  planStartRef?: React.RefObject<number | null>;
  planId?: number | null;
  horizonSec?: number;
  onStrokeEnd?: (pts: DrawPoint[]) => void;
  onLegs?: (n: number) => void;
  onSkin?: (k: string) => void;
  plan?: { direction: "UP" | "DOWN"; stake: bigint }[];
  /** Interaction off, for the presentation layer where it is only a picture. */
  inert?: boolean;
}

/**
 * The device plus its control state, ready to drop on any page.
 *
 * Every surface that shows the device uses this, so the panel, the wheel and the
 * skin behave identically whether it is the play screen, the deck or the home page.
 */
/** Placeholder standings until the indexer query lands. Labelled on the screen. */
const BOARD = [
  { rank: 1, who: "—", plans: 0, hit: "—", ret: "—" },
  { rank: 2, who: "—", plans: 0, hit: "—", ret: "—" },
  { rank: 3, who: "—", plans: 0, hit: "—", ret: "—" },
  { rank: 4, who: "—", plans: 0, hit: "—", ret: "—" },
];

export function DeviceStage(p: Props) {
  const [skinKey, setSkinKey] = useState("frost");
  /** Which channel the big screen carries. The trophy key is a channel on the
   *  machine, not a link off it. */
  const [screen, setScreen] = useState<"chart" | "settings" | "board">("chart");
  const [mode, setMode] = useState<"draw" | "pixel">("draw");
  const [armed, setArmed] = useState(false);
  const skin = skinByKey(skinKey);

  const menu = useDeviceMenu(skin, (k) => { setSkinKey(k); p.onSkin?.(k); }, DEFAULTS, {
    onSwap: () => setScreen((c) => (c === "chart" ? "settings" : "chart")),
    onMode: () => setMode((m) => (m === "draw" ? "pixel" : "draw")),
    onDraw: () => setArmed((v) => !v),
    onBoard: () => setScreen((c) => (c === "board" ? "chart" : "board")),
    onNew: () => { setArmed(false); setScreen("chart"); },
    onCancel: () => { setArmed(false); setScreen("chart"); },
  });

  // Reporting up must NOT happen during render: calling the parent's setState from
  // a child's render body is what React flags as updating a component while
  // rendering another one.
  const { onLegs } = p;
  useEffect(() => { onLegs?.(menu.legs); }, [onLegs, menu.legs]);

  return (
    <Device3D
      skin={skin}
      fill={p.fill} freeOrbit={p.freeOrbit} idleSpin={p.idleSpin} particles={p.particles}
      priceRef={p.priceRef} legsRef={p.legsRef} curveRef={p.curveRef}
      planStartRef={p.planStartRef} planId={p.planId ?? null}
      horizonSec={p.horizonSec} legCount={menu.legs}
      mode={mode} screen={screen} drawArmed={armed && !p.inert}
      floatOnly={p.floatOnly} board={BOARD} plan={p.plan}
      onPickRow={menu.setCursor} onSelect={() => menu.press("authorise")}
      onStrokeEnd={(pts) => { setArmed(false); p.onStrokeEnd?.(pts); }}
      rows={menu.rows} cursor={menu.cursor} editing={menu.editing} connected={menu.connected}
      onKey={p.inert ? undefined : menu.press}
      onScroll={p.inert ? undefined : menu.scroll}
      active={{ draw: armed }}
    />
  );
}
