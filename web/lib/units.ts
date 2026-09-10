import { formatUnits } from "viem";
import { DEFAULT_QUOTE_DECIMALS } from "./venues.ts";

/**
 * Formatting collateral amounts.
 *
 * SEPARATE FROM `chain.ts` ON PURPOSE. `chain.ts` builds a viem public client at
 * module scope, and the renderer in `gb.ts` — which draws these numbers on a
 * canvas hot path — has no business instantiating an RPC transport to format a
 * balance. This module imports one pure function and nothing else.
 */

/**
 * A collateral amount at the scale the VENUE says, not one we assume.
 *
 * `Number(v) / 1e6` was wrong in two separate ways and both matter.
 *
 * SCALE. It hard-codes 6 decimals. Mainnet USDso is 18, and so is a binary venue
 * that has been live on Shannon since early September — so the same expression
 * silently reports an 18dp balance as a number 10^12 too large. Nothing reverts;
 * the UI just says something false, which is the worst failure mode available.
 *
 * PRECISION. `Number(v)` on a bigint past 2^53 is already lossy before the
 * division. `formatUnits` does the shift on the exact integer and hands back a
 * decimal string, so the only rounding is the one `toFixed` is asked for.
 */
export const fmtUnits = (v: bigint, decimals: number, dp = 4) =>
  Number(formatUnits(v, decimals)).toFixed(dp);

/**
 * The same, for callers that have not threaded a venue's decimals through yet.
 *
 * `decimals` is a real parameter, not a constant with a friendly name — pass the
 * venue's `quoteDecimals` wherever one is in scope. The default exists so this
 * stayed a mechanical change; it is not a licence to keep assuming 6.
 */
export const fmtUsdc = (v: bigint, dp = 4, decimals: number = DEFAULT_QUOTE_DECIMALS) =>
  fmtUnits(v, decimals, dp);
