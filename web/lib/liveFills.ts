import { INDEXER } from "./venues.ts";
import { spotMarket } from "./priceSeries.ts";
import { USE_SDK } from "./dreamdex/flag.ts";

/**
 * THE PRICE FEED, PUSHED RATHER THAN POLLED.
 *
 * The chart used to ask the indexer for new fills every 1.5 seconds — about forty
 * requests a minute against a book that prints roughly five times a minute, so
 * upwards of 85% of them returned nothing. The same Hasura endpoint exposes a
 * `subscription_root`, verified live: a `graphql-transport-ws` subscription on the
 * spot `Fill` table pushes as trades land, so a print reaches the screen when it
 * happens instead of on the next tick.
 *
 * IT DOES NOT REPLACE THE POLL, it pre-empts it. The caller keeps its interval and
 * uses `connected` to decide whether to skip a tick, so a blocked WebSocket — a
 * proxy, a captive network, a bad deploy — degrades to exactly the behaviour that
 * shipped before rather than to a frozen chart. That is also why every failure path
 * here is silent: this is an optimisation, and an optimisation that can break the
 * screen is not one.
 *
 * `Fill` rows are immutable, so `timestamp: {_gt: since}` with a rolling `since`
 * would need a new subscription per print. Instead it subscribes ONCE to the newest
 * `LIMIT` rows and the caller de-duplicates on timestamp, which it already does for
 * the polled path.
 */
const LIMIT = 40;

export interface LiveFills {
  /** True while a subscription is open and acknowledged. */
  connected: () => boolean;
  close: () => void;
}

function subscribeFillsLegacy(
  asset: string,
  onPoints: (pts: { t: number; price: number }[]) => void,
): LiveFills {
  let ws: WebSocket | null = null;
  let ack = false;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  /** Backs off so a permanently blocked socket does not reconnect in a tight loop. */
  let attempt = 0;

  const open = async () => {
    if (closed) return;
    let spot: Awaited<ReturnType<typeof spotMarket>> = null;
    try { spot = await spotMarket(asset); } catch { spot = null; }
    if (closed || !spot) return schedule();

    const url = INDEXER.replace(/^http/, "ws");
    try { ws = new WebSocket(url, "graphql-transport-ws"); } catch { return schedule(); }

    ws.onopen = () => ws?.send(JSON.stringify({ type: "connection_init", payload: {} }));
    ws.onerror = () => { ack = false; };
    ws.onclose = () => { ack = false; schedule(); };
    ws.onmessage = (ev) => {
      let m: { type?: string; payload?: unknown };
      try { m = JSON.parse(String(ev.data)); } catch { return; }

      if (m.type === "connection_ack") {
        ack = true;
        attempt = 0;
        ws?.send(JSON.stringify({
          id: "fills", type: "subscribe",
          payload: {
            query: `subscription { Fill(where:{market_id:{_eq:"${spot.id}"}},
              order_by:{timestamp:desc}, limit:${LIMIT}){ timestamp fillPrice } }`,
          },
        }));
        return;
      }

      if (m.type !== "next") return;
      const rows = (m.payload as { data?: { Fill?: { timestamp: string; fillPrice: string }[] } })
        ?.data?.Fill ?? [];
      const out: { t: number; price: number }[] = [];
      let lastT = -1;
      // Oldest first, and the LAST fill in a second wins — a taker sweeping several
      // levels prints more than one row per block. Identical to the polled path, on
      // purpose: two feeds that disagree about a second's close would make the line
      // jitter depending on which one delivered it.
      for (let i = rows.length - 1; i >= 0; i--) {
        const t = Number(rows[i].timestamp);
        const v = BigInt(rows[i].fillPrice);
        const price = Number(v / spot.divisor) + Number(v % spot.divisor) / Number(spot.divisor);
        if (!Number.isFinite(price) || price <= 0) continue;
        if (t === lastT) out[out.length - 1] = { t, price };
        else { out.push({ t, price }); lastT = t; }
      }
      if (out.length) onPoints(out);
    };
  };

  const schedule = () => {
    if (closed || retry) return;
    const wait = Math.min(30_000, 2_000 * 2 ** attempt++);
    retry = setTimeout(() => { retry = null; void open(); }, wait);
  };

  void open();

  return {
    connected: () => ack,
    close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      try { ws?.close(); } catch { /* already gone */ }
      ws = null;
    },
  };
}

/**
 * The pushed feed — the SDK's live tail or this file's own socket.
 *
 * The SDK path streams the oracle feed over the socket the client singleton
 * already owns, so it removes a second socket rather than adding one. Both
 * satisfy the same contract, and the caller's poll fallback is unchanged either
 * way: `connected()` is the only thing it asks.
 *
 * The handle has to exist synchronously, so the SDK path returns immediately and
 * reports `connected() === false` until its watch is hydrated — which is exactly
 * how the legacy socket behaves before its `connection_ack`.
 */
export function subscribeFills(
  asset: string,
  onPoints: (pts: { t: number; price: number }[]) => void,
): LiveFills {
  if (!USE_SDK) return subscribeFillsLegacy(asset, onPoints);

  // The module is loaded lazily, so the handle is a shell that forwards once the
  // real one exists. Returning a Promise instead would change the contract and
  // push async into the render path for no gain.
  let inner: LiveFills | null = null;
  let closed = false;
  void import("./dreamdex/live.ts").then(({ subscribeTicks }) => {
    if (closed) return;
    inner = subscribeTicks(asset, onPoints);
  }).catch(() => { /* stays disconnected; the caller's interval carries it */ });

  return {
    connected: () => !closed && !!inner?.connected(),
    close: () => { closed = true; inner?.close(); inner = null; },
  };
}
