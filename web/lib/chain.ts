import { createPublicClient, defineChain, http } from "viem";
import { CHAIN_ID, RPC } from "./venues";

export const shannon = defineChain({
  id: CHAIN_ID,
  name: "Somnia Shannon",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export const pub = createPublicClient({ chain: shannon, transport: http() });

export const fmtUsdc = (v: bigint, dp = 4) => (Number(v) / 1e6).toFixed(dp);
export const fmtStt = (v: bigint, dp = 4) => (Number(v) / 1e18).toFixed(dp);
