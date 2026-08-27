/** The two live venues. Venue and series are Plan parameters, never constants. */
export interface Venue {
  key: "fast" | "rolling";
  label: string;
  blurb: string;
  venueId: `0x${string}`;
  marketCreator: `0x${string}`;
  rollTopic: `0x${string}`;
  asset: string;
  seriesId: number;
  intervalSec: number;
  /** Seconds after a roll before opening: the successor's book is empty for ~10s. */
  openDelay: number;
  /** Refuse to open into the tail of a Window; the maker pulls quotes near expiry. */
  minHeadroom: number;
}

export const VENUES: Record<Venue["key"], Venue> = {
  fast: {
    key: "fast",
    label: "60 second",
    blurb: "A Plan completes in minutes. Best for watching the chain run.",
    venueId: "0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f",
    marketCreator: "0xee3aff92812a2cb7bf801b500687bc97b55cab34",
    rollTopic: "0x2aba9c4149d9b680f88b57880776a6aa9755ec19e418a1e64831b44c43cb7a1b",
    asset: "BTC",
    seriesId: 3,
    intervalSec: 60,
    openDelay: 22,
    minHeadroom: 12,
  },
  rolling: {
    key: "rolling",
    label: "15 minute",
    blurb: "A real horizon. Eight Legs is two hours of positions.",
    venueId: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
    marketCreator: "0x94d963b6670ab96e78c8d0c46ca35d196d606efe",
    rollTopic: "0x2f81a5d8c4d5d43e0ba57b7ee38e6a5ac6799dd18f58f377d1fc8359d6a27eee",
    asset: "BTC",
    seriesId: 1,
    intervalSec: 900,
    openDelay: 45,
    minHeadroom: 120,
  },
};

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
