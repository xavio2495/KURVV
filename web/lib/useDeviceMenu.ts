"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MenuRow } from "./gb";
import { SKINS, type Skin } from "./skins";
import { ASSETS, windowsFor } from "./venues";
import { HANDLE_VARIANTS, handleFor, readHandleVariant, writeHandleVariant } from "./handle";
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
  tokenChoices: readonly string[];
}

export const DEFAULTS: MenuOptions = {
  stakes: [500_000n, 1_000_000n, 2_000_000n, 5_000_000n, 10_000_000n],
  legChoices: [2, 3, 4, 5, 6, 7, 8],
  tokenChoices: ASSETS,
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
  /** The connected trader's name, or null before a wallet is linked. */
  handle: string | null;
  nameVariant: number;
  scroll: (step: number) => void;
  /** Nudge the stake directly, for the wheel while the chart is up. */
  setStake: (step: number) => void;
  /** Step the asset, for the wheel's right key. Clamps the window with it. */
  nextToken: () => void;
  /** The choices behind a row, and which one is live — for the touch dropdown. */
  optionsFor: (i: number) => readonly string[];
  selectedFor: (i: number) => number;
  /** Pick a value directly, the way a tap does. */
  choose: (rowIndex: number, option: number) => void;
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
    /** Shown on the WALLET row when the chain layer is present. */
    walletLabel?: string;
    /** The connected address. Its handle is the trader's name on the board. */
    address?: string;
    onSwap?: () => void;
    onMode?: () => void;
    onDraw?: () => void;
    onAsset?: () => void;
    onProfile?: () => void;
    onCancel?: () => void;
    /** Returns true if the caller claimed the press, leaving the rows untouched. */
    onCommit?: () => boolean;
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
  const [nameVariant, setNameVariant] = useState(0);

  /**
   * The trader's name.
   *
   * Asked for at connect rather than at first commit, because the board is the
   * reason it exists and a name chosen after the fact would not be on the Plan that
   * earned the place. The device has a wheel and no keyboard, so "choose" means
   * rerolling a deterministic sequence — every variant is a real, stable name for
   * that address, not free text that would need validating and storing.
   */
  const address = hooks.address;
  useEffect(() => {
    if (!address) return;
    const saved = readHandleVariant(address);
    setNameVariant(saved ?? 0);
    if (saved === null) writeHandleVariant(address, 0);
  }, [address]);
  const handle = address ? handleFor(address, nameVariant) : null;

  /**
   * Windows are asset-scoped: the majors roll on two creators with three horizons,
   * the chain's own token on one creator with a single 300s series. Offering a
   * window an asset does not have would be a button that cannot fill.
   */
  const windowChoices = windowsFor(tokenIndex);
  const window_ = Math.min(windowIndex, windowChoices.length - 1);

  const s = useRef({ cursor, editing, stakeIndex, legs, windowIndex: window_, tokenIndex, nameVariant, skinKey: skin.key });
  s.current = { cursor, editing, stakeIndex, legs, windowIndex: window_, tokenIndex, nameVariant, skinKey: skin.key };

  const rows: MenuRow[] = [
    { id: "wallet", label: "WALLET", value: hooks.walletLabel ?? (connected ? "LINKED" : "CONNECT"), editable: false },
    // Only once there is an address to derive it from; an unconnected name is a lie.
    ...(handle ? [{ id: "name" as const, label: "NAME", value: handle.toUpperCase(), editable: true }] : []),
    { id: "stake", label: "STAKE", value: `$${(Number(opts.stakes[stakeIndex]) / 1e6).toFixed(2)}`, editable: true },
    { id: "legs", label: "LEGS", value: String(legs), editable: true },
    { id: "window", label: "WINDOW", value: windowChoices[window_], editable: true },
    { id: "token", label: "TOKEN", value: opts.tokenChoices[tokenIndex], editable: true },
    // Customisation belongs on the device, not in chrome around it.
    { id: "skin", label: "SKIN", value: skin.name.toUpperCase(), editable: true },
  ];

  const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));

  // Rows are keyed by id, never by position: the NAME row appears only once a
  // wallet is connected, so every index below it shifts at runtime.
  const idAt = (i: number) => rows[Math.min(Math.max(i, 0), rows.length - 1)]?.id;

  const scroll = useCallback((step: number) => {
    const c = s.current;
    if (!c.editing) { setCursor(clamp(c.cursor + step, rows.length)); return; }
    switch (idAt(c.cursor)) {
      case "name":
        setNameVariant((v) => {
          const next = (v + step + HANDLE_VARIANTS) % HANDLE_VARIANTS;
          if (address) writeHandleVariant(address, next);
          return next;
        });
        break;
      case "stake": setStakeIndex(clamp(c.stakeIndex + step, opts.stakes.length)); break;
      case "legs": setLegs(opts.legChoices[clamp(opts.legChoices.indexOf(c.legs) + step, opts.legChoices.length)]); break;
      case "window": setWindowIndex(clamp(c.windowIndex + step, windowChoices.length)); break;
      // Changing asset can strand the window index past the end of the new list;
      // clamping here keeps the pair valid at every intermediate step of a scroll.
      case "token": {
        const t = clamp(c.tokenIndex + step, opts.tokenChoices.length);
        setTokenIndex(t);
        setWindowIndex((w) => Math.min(w, windowsFor(t).length - 1));
        break;
      }
      case "skin": {
        const i = SKINS.findIndex((k) => k.key === c.skinKey);
        setSkinKey(SKINS[clamp(i + step, SKINS.length)].key);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts, setSkinKey, windowChoices.length, rows.length, address]);

  const setStake = useCallback((step: number) => {
    setStakeIndex((i) => clamp(i + step, opts.stakes.length));
  }, [opts.stakes.length]);

  const nextToken = useCallback(() => {
    // Both updaters at the top level: a `setState` nested inside another updater runs
    // twice under StrictMode, and an updater is required to be pure.
    const next = (s.current.tokenIndex + 1) % opts.tokenChoices.length;
    setTokenIndex(next);
    setWindowIndex((w) => Math.min(w, windowsFor(next).length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.tokenChoices.length]);

  /**
   * The same value sets, exposed for the touch dropdown.
   *
   * Deliberately derived from the SAME arrays the wheel steps through, so a tap and
   * a scroll can never offer different choices for the same row.
   */
  const optionsFor = useCallback((i: number): readonly string[] => {
    switch (rows[i]?.id) {
      case "name": return Array.from({ length: HANDLE_VARIANTS }, (_, v) =>
        (address ? handleFor(address, v) : "").toUpperCase());
      case "stake": return opts.stakes.map((v) => `$${(Number(v) / 1e6).toFixed(2)}`);
      case "legs": return opts.legChoices.map(String);
      case "window": return windowChoices;
      case "token": return opts.tokenChoices;
      case "skin": return SKINS.map((k) => k.name.toUpperCase());
      default: return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, opts, windowChoices, address]);

  const selectedFor = useCallback((i: number): number => {
    switch (rows[i]?.id) {
      case "name": return nameVariant;
      case "stake": return stakeIndex;
      case "legs": return opts.legChoices.indexOf(legs);
      case "window": return window_;
      case "token": return tokenIndex;
      case "skin": return SKINS.findIndex((k) => k.key === skin.key);
      default: return -1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, opts, nameVariant, stakeIndex, legs, window_, tokenIndex, skin.key]);

  const choose = useCallback((rowIndex: number, option: number) => {
    switch (rows[rowIndex]?.id) {
      case "name":
        setNameVariant(option);
        if (address) writeHandleVariant(address, option);
        break;
      case "stake": setStakeIndex(option); break;
      case "legs": setLegs(opts.legChoices[option]); break;
      case "window": setWindowIndex(option); break;
      case "token":
        setTokenIndex(option);
        setWindowIndex((w) => Math.min(w, windowsFor(option).length - 1));
        break;
      case "skin": setSkinKey(SKINS[option].key); break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, opts, address, setSkinKey]);

  const press = useCallback((id: DeviceId) => {
    const c = s.current;
    switch (id) {
      // The centre key is contextual and always does something, but it must do only
      // ONE thing. It used to run the row action AND fall through to `onCommit`, so a
      // press on WALLET fired the faucet and the commit together, and a press on any
      // other row toggled edit mode nobody asked for on the way past.
      //
      // Which surface owns the key is a question only the caller can answer, so
      // `onCommit` reports whether it claimed the press. The rows move only if it
      // did not.
      case "authorise":
        if (hooks.onCommit?.()) break;
        if (idAt(c.cursor) === "wallet") { setConnected((v) => !v); hooks.onConnect?.(); }
        else setEditing((v) => !v);
        break;
      case "profile": setEditing(false); hooks.onProfile?.(); break;
      case "cancel": setEditing(false); hooks.onCancel?.(); break;
      case "draw": setEditing(false); hooks.onDraw?.(); break;
      case "asset": hooks.onAsset?.(); break;
      // Leaving edit mode armed would hand the wheel to the stake dial on the chart
      // while the settings row it was editing still claims the detent range.
      case "swap": setEditing(false); hooks.onSwap?.(); break;
      case "mode": hooks.onMode?.(); break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hooks.onCommit, hooks.onProfile, hooks.onCancel, hooks.onDraw, hooks.onAsset, hooks.onSwap, hooks.onMode, hooks.onConnect]);

  return {
    rows, cursor, editing, connected, stakeIndex, legs, windowIndex: window_, tokenIndex, skin,
    handle, nameVariant,
    scroll, setStake, nextToken, optionsFor, selectedFor, choose,
    press, setConnected, setCursor,
  };
}
