/** A venue is a (window, asset) pair. Venue and series are Plan parameters, never constants. */
export interface Venue {
  key: VenueKey;
  label: string;
  blurb: string;
  venueId: `0x${string}`;
  marketCreator: `0x${string}`;
  rollTopic: `0x${string}`;
  asset: Asset;
  seriesId: number;
  intervalSec: number;
  /** Seconds after a roll before opening: the successor's book is empty for ~10s. */
  openDelay: number;
  /** Refuse to open into the tail of a Window; the maker pulls quotes near expiry. */
  minHeadroom: number;
}

export const ASSETS = ["BTC", "ETH", "SOMI"] as const;
export type Asset = (typeof ASSETS)[number];

/**
 * Three assets exist on this chain. Only two of them trade.
 *
 * BTC and ETH roll continuously on the two main venues. SOMI has a registered series
 * — seriesId 305, 300s, settling in the same tUSDC — on three deployed
 * `MarketCreator` contracts, but **not one of them has ever rolled a market**: zero
 * markets in the indexer's whole history and zero logs in the last 20,000 blocks.
 * The series is configured below exactly as the registry describes it, so the day
 * those creators start rolling it works with no code change; until then the liveness
 * probe reports it dead and the device says so instead of failing at commit time.
 *
 * XRP, SOL and BNB have never existed here in any form.
 *
 * The SOMI creators have never emitted, so their roll topic could not be observed.
 * It was read out of their runtime bytecode instead, which contains the constant for
 * `SeriesRolled(uint32,bytes32,address)` — the same signature the rolling venue uses.
 */

/**
 * The venue shells. Both assets ride the SAME MarketCreator and the same roll
 * event; only `seriesId` differs, so switching asset costs nothing on-chain — one
 * subscription filter, one topic, a different series number.
 *
 * The series numbers were read off `SeriesRolled` logs rather than assumed. Odd is
 * BTC, even is ETH, and the pairing is per-creator, not global.
 */
const SHELL = {
  fast: {
    venueId: "0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f",
    marketCreator: "0xee3aff92812a2cb7bf801b500687bc97b55cab34",
    rollTopic: "0x2aba9c4149d9b680f88b57880776a6aa9755ec19e418a1e64831b44c43cb7a1b",
  },
  rolling: {
    venueId: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
    marketCreator: "0x94d963b6670ab96e78c8d0c46ca35d196d606efe",
    rollTopic: "0x2f81a5d8c4d5d43e0ba57b7ee38e6a5ac6799dd18f58f377d1fc8359d6a27eee",
  },
  somi: {
    venueId: "0xd5fc2dc5e0133842011dfc657ce39cb3a4534f4fc368e23af5b23594eeeac6d7",
    marketCreator: "0xe207b1fa953b2e18ef46879555946cb5fa7ce74e",
    rollTopic: "0x2f81a5d8c4d5d43e0ba57b7ee38e6a5ac6799dd18f58f377d1fc8359d6a27eee",
  },
} as const;

type WindowKey = "fast" | "mid" | "hour" | "rolling" | "somi";

interface Row {
  key: WindowKey;
  shell: keyof typeof SHELL;
  label: string;
  blurb: string;
  /** Series per asset on that creator, indexed like `ASSETS`. `null` = not offered. */
  series: readonly (number | null)[];
  intervalSec: number;
  openDelay: number;
  minHeadroom: number;
}

/**
 * The windows the device offers.
 *
 * 15 MINUTE IS ABSENT DELIBERATELY. The rolling venue's 900s series (s1/s2) stopped
 * rolling on 29 Aug 2026: its newest window expired twelve hours earlier and was
 * never finalised, so `liveMarket` finds nothing and every commit throws. It is a
 * testnet outage, not a retirement — the row below is kept, correct and ready. Put
 * `"15m"` back in `WINDOWS` once `Market(intervalSec: 900)` shows an unexpired row
 * again, and check that before relying on it in a demo.
 */
const ROWS: readonly Row[] = [
  {
    key: "fast", shell: "fast", label: "60 second",
    blurb: "A Plan completes in minutes. Best for watching the chain run.",
    series: [3, 4, null], intervalSec: 60, openDelay: 22, minHeadroom: 12,
  },
  {
    key: "mid", shell: "fast", label: "5 minute",
    blurb: "Eight Legs is forty minutes. The demo horizon.",
    series: [1, 2, null], intervalSec: 300, openDelay: 22, minHeadroom: 45,
  },
  {
    key: "hour", shell: "rolling", label: "1 hour",
    blurb: "A real horizon. Eight Legs is a working day of positions.",
    series: [3, 4, null], intervalSec: 3600, openDelay: 45, minHeadroom: 180,
  },
  {
    key: "rolling", shell: "rolling", label: "15 minute",
    blurb: "A real horizon. Eight Legs is two hours of positions.",
    series: [1, 2, null], intervalSec: 900, openDelay: 45, minHeadroom: 120,
  },
  // SOMI lives on its own creator and offers exactly one window.
  {
    key: "somi", shell: "somi", label: "5 minute",
    blurb: "The chain's own token, on its own venue.",
    series: [null, null, 305], intervalSec: 300, openDelay: 22, minHeadroom: 45,
  },
];

export type VenueKey = `${WindowKey}-${Lowercase<Asset>}`;

const slug = (a: Asset) => a.toLowerCase() as Lowercase<Asset>;

export const VENUES: Partial<Record<VenueKey, Venue>> = Object.fromEntries(
  ROWS.flatMap((r) =>
    ASSETS.flatMap((asset, i): [VenueKey, Venue][] => {
      const seriesId = r.series[i];
      if (seriesId === null || seriesId === undefined) return [];
      const key = `${r.key}-${slug(asset)}` as VenueKey;
      return [[key, {
        key, label: r.label, blurb: r.blurb, ...SHELL[r.shell],
        asset, seriesId,
        intervalSec: r.intervalSec, openDelay: r.openDelay, minHeadroom: r.minHeadroom,
      }]];
    }),
  ),
);

/**
 * The window choices, per asset.
 *
 * They differ because the venues differ: BTC and ETH roll on the two main creators,
 * SOMI on its own with a single 300s series. Offering a window an asset does not
 * have would be a button that cannot fill, so the list is asset-scoped rather than
 * global.
 *
 * 15 MINUTE IS ABSENT for BTC and ETH — see the note on `ROWS`.
 */
const WINDOWS_BY_ASSET: Record<Asset, readonly { label: string; key: WindowKey }[]> = {
  BTC: [{ label: "60s", key: "fast" }, { label: "5m", key: "mid" }, { label: "1h", key: "hour" }],
  ETH: [{ label: "60s", key: "fast" }, { label: "5m", key: "mid" }, { label: "1h", key: "hour" }],
  SOMI: [{ label: "5m", key: "somi" }],
};

export function windowsFor(assetIndex: number): readonly string[] {
  return WINDOWS_BY_ASSET[ASSETS[Math.min(assetIndex, ASSETS.length - 1)]].map((w) => w.label);
}

export function venueKeyOf(windowIndex: number, assetIndex: number): VenueKey {
  const asset = ASSETS[Math.min(assetIndex, ASSETS.length - 1)];
  const list = WINDOWS_BY_ASSET[asset];
  return `${list[Math.min(windowIndex, list.length - 1)].key}-${slug(asset)}` as VenueKey;
}


/**
 * Look a venue up. Not every (window, asset) pair exists — SOMI has one window and
 * the majors have three — so the map is sparse by construction, and a stale saved
 * key must land somewhere real rather than crashing the page it is restoring.
 */
export function venueOf(k: VenueKey): Venue {
  return VENUES[k] ?? VENUES["fast-btc"]!;
}

/** CREATE3 core — identical on testnet and mainnet. Per-market addresses rotate. */
export const ADDR = {
  tusdc: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  module: "0x3ecC694Cef705358864a646142ac17A90E29e388",
  outcome: "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9",
} as const;

export const INDEXER = "https://dev.smk.somnia.host/v1/graphql";
export const RPC = "https://dream-rpc.somnia.network";
export const CHAIN_ID = 50312;
export const EXPLORER = "https://shannon-explorer.somnia.network";
