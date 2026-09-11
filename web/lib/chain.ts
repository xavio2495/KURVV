import { createPublicClient, defineChain, http } from "viem";
import { CHAIN_ID, RPC } from "./venues.ts";

export const shannon = defineChain({
  id: CHAIN_ID,
  name: "Somnia Shannon",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export const pub = createPublicClient({ chain: shannon, transport: http() });

// Amount formatting lives in `units.ts` so the canvas renderer can import it
// without dragging a public client along. Re-exported for existing callers.
export { fmtUnits, fmtUsdc } from "./units.ts";
