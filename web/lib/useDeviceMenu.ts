"use client";
import { useCallback, useRef, useState } from "react";
import type { MenuRow } from "./gb";
import { SKINS, type Skin } from "./skins";
import type { DeviceId } from "./three/device";

/**
 * The device's own control state.
 *
 * Shared by every surface that mounts the device, so the panel behaves identically
 * on the play screen, the showcase and the guided demo. The scroll moves the cursor;
 * the centre select enters a row; inside a row the scroll changes the value.
 */
export interface MenuOptions {
  stakes: readonly bigint[];
  legChoices: readonly number[];
  windowChoices: readonly string[];
  tokenChoices: readonly string[];
}

export const DEFAULTS: MenuOptions = {
  stakes: [500_000n, 1_000_000n, 2_000_000n, 5_000_000n, 10_000_000n],
  legChoices: [2, 3, 4, 5, 6, 7, 8],
  windowChoices: ["60s", "15m"],
  tokenChoices: ["BTC"],
};

export interface MenuState {
  rows: MenuRow[];
  cursor: number;
  editing: boolean;
  connected: boolean;
  stakeIndex: number;
  legs: number;
  windowIndex: number;
  tokenIndex: number;
  skin: Skin;
  scroll: (step: number) => void;
  press: (id: DeviceId) => void;
  setConnected: (v: boolean) => void;
  /** Aim the cursor directly, for a tap on the settings glass. */
  setCursor: (i: number) => void;
}

export function useDeviceMenu(
  skin: Skin,
  setSkinKey: (k: string) => void,
  opts: MenuOptions = DEFAULTS,
  hooks: {
    onSwap?: () => void;
    onMode?: () => void;
    onDraw?: () => void;
    onBoard?: () => void;
    onNew?: () => void;
    onCancel?: () => void;
    onCommit?: () => void;
    onConnect?: () => void;
  } = {},
): MenuState {
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [stakeIndex, setStakeIndex] = useState(2);
  const [legs, setLegs] = useState(6);
  const [windowIndex, setWindowIndex] = useState(0);
  const [tokenIndex, setTokenIndex] = useState(0);

  const s = useRef({ cursor, editing, stakeIndex, legs, windowIndex, tokenIndex, skinKey: skin.key });
  s.current = { cursor, editing, stakeIndex, legs, windowIndex, tokenIndex, skinKey: skin.key };

  const rows: MenuRow[] = [
    { id: "wallet", label: "WALLET", value: connected ? "LINKED" : "CONNECT", editable: false },
    { id: "stake", label: "STAKE", value: `$${(Number(opts.stakes[stakeIndex]) / 1e6).toFixed(2)}`, editable: true },
    { id: "legs", label: "LEGS", value: String(legs), editable: true },
    { id: "window", label: "WINDOW", value: opts.windowChoices[windowIndex], editable: true },
    { id: "token", label: "TOKEN", value: opts.tokenChoices[tokenIndex], editable: true },
    // Customisation belongs on the device, not in chrome around it.
    { id: "skin", label: "SKIN", value: skin.name.toUpperCase(), editable: true },
  ];

  const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));

  const scroll = useCallback((step: number) => {
    const c = s.current;
    if (!c.editing) { setCursor(clamp(c.cursor + step, 6)); return; }
    switch (c.cursor) {
      case 1: setStakeIndex(clamp(c.stakeIndex + step, opts.stakes.length)); break;
      case 2: setLegs(opts.legChoices[clamp(opts.legChoices.indexOf(c.legs) + step, opts.legChoices.length)]); break;
      case 3: setWindowIndex(clamp(c.windowIndex + step, opts.windowChoices.length)); break;
      case 4: setTokenIndex(clamp(c.tokenIndex + step, opts.tokenChoices.length)); break;
      case 5: {
        const i = SKINS.findIndex((k) => k.key === c.skinKey);
        setSkinKey(SKINS[clamp(i + step, SKINS.length)].key);
        break;
      }
    }
  }, [opts, setSkinKey]);

  const press = useCallback((id: DeviceId) => {
    const c = s.current;
    switch (id) {
      case "authorise":
        if (c.cursor === 0) { setConnected((v) => !v); hooks.onConnect?.(); }
        else setEditing((v) => !v);
        hooks.onCommit?.();
        break;
      case "new": setCursor(0); setEditing(false); hooks.onNew?.(); break;
      case "cancel": setEditing(false); hooks.onCancel?.(); break;
      case "draw": setEditing(false); hooks.onDraw?.(); break;
      case "board": hooks.onBoard?.(); break;
      case "swap": hooks.onSwap?.(); break;
      case "mode": hooks.onMode?.(); break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hooks.onCommit, hooks.onNew, hooks.onCancel, hooks.onDraw, hooks.onBoard, hooks.onSwap, hooks.onMode, hooks.onConnect]);

  return {
    rows, cursor, editing, connected, stakeIndex, legs, windowIndex, tokenIndex, skin,
    scroll, press, setConnected, setCursor,
  };
}
