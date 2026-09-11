import type { LiveFills } from "../liveFills.ts";

/**
 * The pushed price feed, through the SDK's own live tail.
 *
 * DROP-IN FOR `subscribeFills`, deliberately. That function's contract is the
 * valuable part and it is preserved exactly: construct synchronously, report
 * `connected()` honestly, and `close()` cleanly. The play page keeps its
 * interval and skips a tick only while `connected()` is true, so a blocked
 * socket — a proxy, a captive network, a bad deploy — degrades to polling
 * instead of freezing the chart. That property is why every failure path here
 * is silent: this is an optimisation, and an optimisation that can break the
 * screen is not one.
 *
 * WHAT CHANGES UNDERNEATH. `subscribeFills` opens its own
 * `graphql-transport-ws` socket to the indexer and subscribes to spot `Fill`
 * rows. `watchPrice` hydrates a snapshot and then streams the oracle feed.
 *
 * THAT IS A DIFFERENT SOCKET, NOT A SHARED ONE. Prices are a separate store and
 * a separate service from the market tail — hence `subscribePrices` rather than
 * `subscribeLive` below — and the stream lands on its own endpoint
 * (`wss://price-feed.…`) rather than the indexer's. Counted at runtime: one
 * socket on the legacy path, one on this one. A swap, not an addition.
 *
 * Ref-counted by the SDK: watching the same asset twice shares one
 * subscription, and a brief linger absorbs an unmount/remount without
 * re-snapshotting. `stop()` releases one reference.
 */
export function subscribeTicks(
  asset: string,
  onPoints: (pts: { t: number; price: number }[]) => void,
): LiveFills {
  let stopWatch: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let isLive = () => false;
  let closed = false;
  /**
   * The newest second already delivered.
   *
   * The tick tape is a rolling window, not a cursor, so every store change
   * re-presents ticks that have already been sent. The caller de-duplicates
   * too, but doing it here keeps the batches small on a feed that posts about
   * once a second.
   */
  let lastT = 0;

  void (async () => {
    try {
      const { sdk } = await import("./client.ts");
      const c = sdk();
      if (closed) return;

      const handle = await c.watchPrice(asset);
      if (closed) { handle.stop(); return; }
      stopWatch = () => handle.stop();
      isLive = () => c.getPriceStatus(asset) === "live";

      const drain = () => {
        // Newest first out of the store; the chart wants oldest first.
        const ticks = c.getLivePriceTicks(asset, { limit: 200 });
        const out: { t: number; price: number }[] = [];
        let seen = -1;
        for (let i = ticks.length - 1; i >= 0; i--) {
          const t = Number(ticks[i].blockTimestamp);
          const price = Number(ticks[i].price);
          if (!Number.isFinite(price) || price <= 0 || t <= lastT) continue;
          // The last observation in a second is that second's close. Overwrite
          // rather than stack — identical to the polled path on purpose, since
          // two feeds that disagreed about a second's close would make the line
          // jitter depending on which one delivered it.
          if (t === seen) out[out.length - 1] = { t, price };
          else { out.push({ t, price }); seen = t; }
        }
        if (out.length) {
          lastT = out[out.length - 1].t;
          onPoints(out);
        }
      };

      // `subscribePrices`, not `subscribeLive` — prices are a separate store and
      // a separate service from the market tail.
      unsubscribe = c.subscribePrices(drain);
      drain(); // the hydration snapshot is already there; do not wait for a tick
    } catch {
      // Stays disconnected; the caller's interval carries the chart.
    }
  })();

  return {
    connected: () => !closed && isLive(),
    close: () => {
      closed = true;
      try { unsubscribe?.(); } catch { /* already gone */ }
      try { stopWatch?.(); } catch { /* already gone */ }
      unsubscribe = null;
      stopWatch = null;
    },
  };
}
