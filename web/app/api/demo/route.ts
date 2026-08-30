import { NextResponse } from "next/server";
import { createWalletClient, http, parseEther, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { shannon, pub } from "../../../lib/chain";
import { batchExecutorAbi } from "../../../lib/abi";
import { encodeFunctionData } from "viem";

/**
 * Server-side signer for the DEMO wallet.
 *
 * WHY THIS ROUTE EXISTS. The demo key used to be handed to the browser through a
 * `NEXT_PUBLIC_` variable. Next.js inlines those into the client bundle by design, so
 * the key was served to every visitor — we found it in `.next/static/chunks` and
 * reachable over HTTP. It now lives in `DEMO_PRIVATE_KEY`, with no `NEXT_PUBLIC_`
 * prefix, so it cannot be inlined; signing happens here and only the resulting
 * transaction hash crosses to the browser.
 *
 * This key funds DEMO MONEY ONLY. It is not the treasury.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_EXECUTOR = (process.env.NEXT_PUBLIC_BATCH_EXECUTOR ??
  "0x8aee0794ad361258422d96e70df13624fa92e5cd") as Address;

function signer() {
  const raw = process.env.DEMO_PRIVATE_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  const account = privateKeyToAccount(key);
  return { account, wallet: createWalletClient({ account, chain: shannon, transport: http() }) };
}

const indicator = (d: Address) => `0xef0100${d.slice(2)}`.toLowerCase();

/**
 * THE GAS DRIP — how a brand-new Privy wallet becomes able to transact.
 *
 * tUSDC self-mints, so collateral is a solved problem. STT is not: gas comes from
 * Somnia's external faucet, which this app cannot trigger, so an embedded wallet
 * created from an email address lands on the device with a balance it cannot spend.
 * Onboarding that ends at "you have no gas" is not onboarding.
 *
 * Measured, not guessed: at 6 gwei the FIRST commit costs ~0.072 STT (it carries an
 * explicit 12M gas limit — see the delegation trap below) and every later one about
 * 0.009. A drip of 0.25 covers a first commit plus roughly twenty more.
 *
 * THREE THINGS KEEP THIS FROM BEING A DRAIN:
 *   1. OFF BY DEFAULT. `DEMO_FUND_GAS` is server-side and unset unless someone opts
 *      in, so a deployment cannot start giving funds away by accident.
 *   2. TOP-UP, NOT PAYOUT. An address already above `GAS_FLOOR` is refused, so
 *      calling it in a loop returns the same refusal rather than more money.
 *   3. Testnet STT only, from the demo key, which is not the treasury.
 */
const GAS_DRIP = parseEther("0.25");
const GAS_FLOOR = parseEther("0.05");
const FUND_ENABLED = process.env.DEMO_FUND_GAS === "1";

export async function GET() {
  const s = signer();
  if (!s) return NextResponse.json({ address: null, delegated: false, configured: false });
  const code = await pub.getCode({ address: s.account.address });
  return NextResponse.json({
    address: s.account.address,
    delegated: !!code && code.toLowerCase() === indicator(BATCH_EXECUTOR),
    configured: true,
  });
}

export async function POST(req: Request) {
  const s = signer();
  if (!s) return NextResponse.json({ error: "DEMO_PRIVATE_KEY is not configured" }, { status: 500 });

  const body = (await req.json()) as {
    action: "send" | "sendBatch" | "fund";
    call?: { to: Address; value: string; data: Hex };
    calls?: { to: Address; value: string; data: Hex }[];
    /** The address to top up. `fund` only. */
    to?: Address;
  };

  try {
    if (body.action === "fund") {
      if (!FUND_ENABLED) {
        return NextResponse.json({ error: "gas drip is disabled — set DEMO_FUND_GAS=1" }, { status: 403 });
      }
      // Validated, not trusted: this is the one action that moves funds to an address
      // the CLIENT chose, so it must be a well-formed address and nothing else.
      if (!body.to || !isAddress(body.to)) {
        return NextResponse.json({ error: "bad address" }, { status: 400 });
      }
      const have = await pub.getBalance({ address: body.to });
      if (have >= GAS_FLOOR) {
        return NextResponse.json({ error: "already funded", balance: have.toString() }, { status: 409 });
      }
      const hash = await s.wallet.sendTransaction({
        account: s.account, chain: null, to: body.to, value: GAS_DRIP,
      });
      return NextResponse.json({ hash });
    }

    if (body.action === "send" && body.call) {
      const hash = await s.wallet.sendTransaction({
        account: s.account, chain: null,
        to: body.call.to, value: BigInt(body.call.value), data: body.call.data,
      });
      return NextResponse.json({ hash });
    }

    if (body.action === "sendBatch" && body.calls) {
      const calls = body.calls.map((c) => ({ to: c.to, value: BigInt(c.value), data: c.data }));
      const data = encodeFunctionData({ abi: batchExecutorAbi, functionName: "execute", args: [calls] });
      const code = await pub.getCode({ address: s.account.address });
      const already = !!code && code.toLowerCase() === indicator(BATCH_EXECUTOR);

      if (already) {
        const hash = await s.wallet.sendTransaction({ account: s.account, chain: null, to: s.account.address, data });
        return NextResponse.json({ hash });
      }

      // First batch also installs the delegation. Gas MUST be explicit: the node
      // estimates against pre-delegation state, where calling the account is a no-op
      // costing ~21k, and the inner call then dies with an empty revert.
      const authorization = await s.wallet.signAuthorization({
        account: s.account, contractAddress: BATCH_EXECUTOR, executor: "self",
      });
      const hash = await s.wallet.sendTransaction({
        account: s.account, chain: null, to: s.account.address, data,
        authorizationList: [authorization], gas: 12_000_000n,
      });
      return NextResponse.json({ hash });
    }
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 500 });
  }
}
