import { createPublicClient, createWalletClient, http, defineChain, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: new URL("../../scripts/probe/.env.local", import.meta.url).pathname });

export const shannon = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://dream-rpc.somnia.network"] } },
});

/** Permanent addresses only. Per-market and per-pool addresses are read at runtime. */
export const ADDR = {
  module: "0x3ecC694Cef705358864a646142ac17A90E29e388",
  outcome: "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9",
  tusdc: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  marketCreator: "0x94d963b6670ab96e78c8d0c46ca35d196d606efe",
} as const satisfies Record<string, Address>;

export const INDEXER = "https://dev.smk.somnia.host/v1/graphql";
export const VENUE = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
export const SERIES_BTC_15M = 1;

const raw = process.env.PROBE_PRIVATE_KEY?.trim().replace(/^["']|["']$/g, "");
if (!raw) throw new Error("PROBE_PRIVATE_KEY missing (scripts/probe/.env.local)");
// cast accepts a bare 32-byte hex string; viem requires the 0x prefix.
const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
export const account = privateKeyToAccount(key);

export const pub = createPublicClient({ chain: shannon, transport: http() });
export const wallet = createWalletClient({ account, chain: shannon, transport: http() });

export function artifact(name: string) {
  const p = new URL(`../artifacts/contracts/${name}.sol/${name}.json`, import.meta.url).pathname;
  return JSON.parse(readFileSync(p, "utf8")) as { abi: any[]; bytecode: `0x${string}` };
}

export async function gql<T>(query: string): Promise<T> {
  const r = await fetch(INDEXER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = (await r.json()) as { data?: T; errors?: unknown };
  if (!j.data) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

export interface LiveMarket {
  marketId: `0x${string}`;
  poolAddress: Address;
  expiry: number;
  tradingStart: number;
}

/** The currently-Trading BTC 15m market with at least `minHeadroom` seconds left. */
export async function liveBtc15m(minHeadroom = 150): Promise<LiveMarket | null> {
  const cutoff = Math.floor(Date.now() / 1000) + minHeadroom;
  const d = await gql<{ Market: any[] }>(`{ Market(where:{
      venueId:{_eq:"${VENUE}"}, asset:{_eq:"BTC"}, intervalSec:{_eq:"900"},
      finalized:{_eq:false}, expiry:{_gt:"${cutoff}"}
    }, order_by:{expiry:asc}, limit:1){ marketId poolAddress expiry tradingStart } }`);
  const m = d.Market[0];
  return m
    ? { marketId: m.marketId, poolAddress: m.poolAddress, expiry: +m.expiry, tradingStart: +m.tradingStart }
    : null;
}

export const fmtUsdc = (v: bigint) => `${(Number(v) / 1e6).toFixed(6)} tUSDC`;
export const fmtStt = (v: bigint) => `${(Number(v) / 1e18).toFixed(6)} STT`;

export async function balances(label: string, plan?: Address) {
  const erc20 = [
    { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  ];
  const who: [string, Address][] = [["wallet", account.address]];
  if (plan) who.push(["plan  ", plan]);
  console.log(`\n── balances (${label}) ──`);
  for (const [n, a] of who) {
    const stt = await pub.getBalance({ address: a });
    const usd = (await pub.readContract({ address: ADDR.tusdc, abi: erc20 as any, functionName: "balanceOf", args: [a] })) as bigint;
    console.log(`  ${n}  ${fmtStt(stt).padStart(16)}   ${fmtUsdc(usd).padStart(18)}   ${a}`);
  }
}
