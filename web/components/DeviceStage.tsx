"use client";
import { useEffect, useRef, useState } from "react";
import { Device3D, type DeviceId, type Mode } from "./Device3D";
import { useDeviceMenu, DEFAULTS } from "../lib/useDeviceMenu";
import { SKINS, skinByKey } from "../lib/skins";
import { ASSETS, venueKeyOf, windowsFor, type Venue } from "../lib/venues";
import { sfx } from "../lib/sfx";
import { useBoard } from "../lib/useBoard";
import type { DrawPoint } from "../lib/three/chart";
import type { PixelCells } from "../lib/pixel";
import type { FireRow } from "../lib/screen";
import type { GatesData } from "../lib/three/gates";
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
  curveRef?: React.RefObject<DrawPoint[][]>;
  cellsRef?: React.RefObject<PixelCells>;
  /** Told when the gesture mode changes, so the page can rebuild the right preview. */
  onMode?: (m: Mode) => void;
  planStartRef?: React.RefObject<number | null>;
  planId?: number | null;
  horizonSec?: number;
  onStrokeEnd?: () => void;
  onLegs?: (n: number) => void;
  onVenue?: (k: Venue["key"]) => void;
  onStake?: (i: number) => void;
  onSkin?: (k: string) => void;
  /** The chain half. Present on the play surface, absent on presentation pages. */
  chain?: {
    address?: `0x${string}`;
    bal: { stt: bigint; usdc: bigint } | null;
    delegated: boolean | null;
    dryRun: boolean | null;
    connected: boolean;
    hasPlan: boolean;
    canCommit: boolean;
    connect: () => void | Promise<void>;
    faucet: () => void | Promise<void>;
    commit: () => void;
    cancel: () => void | Promise<void>;
    reset: () => void;
  };
  plan?: { direction: "UP" | "DOWN"; stake: bigint }[];
  /** Whether the selected venue has an open Window. `null` while unknown. */
  venueLive?: boolean | null;
  /** Flappy mode: the normalised gates, and the run's input while one is sweeping. */
  gates?: Omit<GatesData, "rect"> | null;
  onFlap?: ((up: boolean) => void) | null;
  onStartRun?: () => void;
  /** The Reactivity fire feed and its state, for the autonomy channel. */
  fires?: FireRow[];
  fireState?: { scanning: boolean; error: string | null; hasPlan: boolean; nextOpenSec: number | null };
  /** Interaction off, for the presentation layer where it is only a picture. */
  inert?: boolean;
}

/**
 * The device plus its control state, ready to drop on any page.
 *
 * Every surface that shows the device uses this, so the panel, the wheel and the
 * skin behave identically whether it is the play screen, the deck or the home page.
 */
export function DeviceStage(p: Props) {
  const [skinKey, setSkinKey] = useState("frost");
  /** Which channel the big screen carries. The trophy key is a channel on the
   *  machine, not a link off it. */
  const [screen, setScreen] = useState<"chart" | "settings" | "board" | "autonomy">("chart");
  const [mode, setMode] = useState<Mode>("draw");
  const [armed, setArmed] = useState(false);
  const [askName, setAskName] = useState(false);
  /** Which row's dropdown is open on the touch panel. */
  const [openRow, setOpenRow] = useState<number | null>(null);
  // The asset key needs the menu, and the menu needs the asset key's handler.
  const menuRef = useRef<{ nextToken: () => void } | null>(null);
  const skin = skinByKey(skinKey);

  const chain = p.chain;
  // Re-read the standings whenever this wallet's own Plan count changes: the row it
  // just earned should be there when the trophy key is pressed, not 25 seconds later.
  const board = useBoard(chain?.address, chain?.hasPlan ? 1 : 0);
  const menu = useDeviceMenu(skin, (k) => { setSkinKey(k); p.onSkin?.(k); }, DEFAULTS, {
    address: chain?.address,
    walletLabel: chain
      ? (chain.address ? `${chain.address.slice(0, 6)}…${chain.address.slice(-4)}` : "CONNECT")
      : undefined,
    onSwap: () => { sfx.swap(); setOpenRow(null); setScreen((c) => (c === "chart" ? "settings" : "chart")); },
    // The play key steps the game: a curve, a grid, and the one still being designed.
    onMode: () => setMode((m) => {
      const next: Mode = m === "draw" ? "pixel" : m === "pixel" ? "flappy" : "draw";
      sfx.mode(next !== "draw");
      return next;
    }),
    onDraw: () => {
      // In flappy the pencil is START, not arm: there is no stroke to make, and the
      // run is the gesture. While one is sweeping the key belongs to the game.
      if (mode === "flappy") { p.onStartRun?.(); return; }
      setArmed((v) => !v);
    },
    // RIGHT: step the asset the chart follows. One press, one instrument.
    onAsset: () => { setScreen("chart"); menuRef.current?.nextToken(); },
    /**
     * TOP: the trader — their name, their standings, and the proof that nobody
     * signed the Legs. Three read-only screens behind one key, because the autonomy
     * feed is the technical claim of the whole product and a panel nothing routes to
     * is a panel nobody sees.
     */
    onProfile: () => setScreen((c) => (c === "board" ? "autonomy" : c === "autonomy" ? "chart" : "board")),

    // Back steps out of a row; with a Plan running it is the cancel key.
    onCancel: () => {
      setArmed(false);
      if (openRow !== null) { setOpenRow(null); return; }
      if (screen !== "chart") { setScreen("chart"); return; }
      if (chain?.hasPlan) void chain.cancel();
    },
    // Selecting the WALLET row connects, or tops up once connected.
    onConnect: () => {
      if (!chain) return;
      if (chain.connected) { void chain.faucet(); return; }
      void chain.connect();
      // Land on NAME once the address exists. The board is why the name matters, and
      // a name picked later would not be on the Plan that earned the place.
      setAskName(true);
    },
    /**
     * The centre key is contextual, and deliberately so: inside the settings screen
     * it selects a row, and on the chart with a Plan drawn it is the commit. The
     * bolt already means "send it" — giving commit its own key would leave the most
     * important action on the least obvious control.
     */
    onCommit: () => { if (screen === "chart" && chain?.canCommit) { sfx.commit(); chain.commit(); } },
  });

  // Reporting up must NOT happen during render: calling the parent's setState from
  // a child's render body is what React flags as updating a component while
  // rendering another one.
  const { onLegs } = p;
  useEffect(() => { onLegs?.(menu.legs); }, [onLegs, menu.legs]);
  const { onVenue, onStake } = p;
  // Window and asset together name the venue: same creator, same roll topic, a
  // different seriesId. Neither choice means anything without the other.
  useEffect(() => {
    onVenue?.(venueKeyOf(menu.windowIndex, menu.tokenIndex));
  }, [onVenue, menu.windowIndex, menu.tokenIndex]);
  useEffect(() => { onStake?.(menu.stakeIndex); }, [onStake, menu.stakeIndex]);
  const { onMode } = p;
  useEffect(() => { onMode?.(mode); }, [onMode, mode]);

  // The NAME row only exists once there is an address to derive it from, so the jump
  // waits for the row to appear rather than for the connect call to return.
  menuRef.current = { nextToken: menu.nextToken };

  const nameRow = menu.rows.findIndex((r) => r.id === "name");
  useEffect(() => {
    if (!askName || nameRow < 0) return;
    setAskName(false);
    menu.setCursor(nameRow);
    setScreen("settings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askName, nameRow]);

  /**
   * Where the roller sits in whatever run it is currently driving — the cursor down
   * the rows, or the value inside the row being edited. The detent click is pitched
   * from it, so the ear can tell the top of a range from the bottom.
   */
  const [rollerStep, rollerSpan] = menu.editing
    ? ([
        [0, 1],
        [menu.stakeIndex, DEFAULTS.stakes.length],
        [DEFAULTS.legChoices.indexOf(menu.legs), DEFAULTS.legChoices.length],
        [menu.windowIndex, windowsFor(menu.tokenIndex).length],
        [menu.tokenIndex, DEFAULTS.tokenChoices.length],
        [SKINS.findIndex((k) => k.key === skinKey), SKINS.length],
      ][menu.cursor] ?? [0, 1])
    : [menu.cursor, menu.rows.length];

  return (
    <Device3D
      skin={skin}
      fill={p.fill} freeOrbit={p.freeOrbit} idleSpin={p.idleSpin} particles={p.particles}
      priceRef={p.priceRef} legsRef={p.legsRef} curveRef={p.curveRef} cellsRef={p.cellsRef}
      planStartRef={p.planStartRef} planId={p.planId ?? null}
      horizonSec={p.horizonSec} legCount={menu.legs} asset={ASSETS[menu.tokenIndex]}
      mode={mode} screen={screen} drawArmed={armed && !p.inert}
      floatOnly={p.floatOnly} board={board.rows} boardSample={board.sample}
      plan={p.plan} venueLive={p.venueLive ?? null}
      fires={p.fires} fireState={p.fireState}
      gates={p.gates} onFlap={p.onFlap ?? null}
      balance={chain?.bal?.usdc ?? null} stake={DEFAULTS.stakes[menu.stakeIndex]}
      onPickRow={(i) => {
        menu.setCursor(i);
        // A row with choices opens them; one without just takes the cursor.
        setOpenRow(menu.optionsFor(i).length ? i : null);
      }}
      onPickOption={(row, option) => {
        if (option >= 0) menu.choose(row, option);
        setOpenRow(null);
      }}
      open={openRow === null ? null : {
        row: openRow,
        options: menu.optionsFor(openRow),
        selected: menu.selectedFor(openRow),
      }}
      onSelect={() => menu.press("authorise")}
      onStrokeEnd={() => { setArmed(false); p.onStrokeEnd?.(); }}
      rows={menu.rows} cursor={menu.cursor} editing={menu.editing}
      connected={chain ? chain.connected : menu.connected}
      onKey={p.inert ? undefined : menu.press}
      onScroll={p.inert ? undefined : (step) => {
        // On the chart the settings list is not even on screen, so moving a cursor
        // nobody can see is worse than useless. The wheel becomes the stake dial.
        if (screen === "chart") { menu.setStake(step); return; }
        menu.scroll(step);
      }}
      active={{ draw: armed }}
      rollerStep={rollerStep} rollerSpan={rollerSpan}
    />
  );
}
