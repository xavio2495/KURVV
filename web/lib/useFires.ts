"use client";
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { pub } from "./chain";
import { BLOCKS_PER_SEC, LOG_SPAN, readFires, type Fire } from "./autonomy";

/** Never backfill more than this — a stale Plan must not fire 700 log pages. */
const MAX_BACKFILL_PAGES = 90n;

export interface FireFeed {
  fires: Fire[];
  /** Milliseconds at which the handler says the next open fires, if it has said. */
  scheduledOpenMs: number | null;
  scanning: boolean;
  error: string | null;
}

/**
 * Poll the PlanBook's own logs forward and turn them into Fires.
 *
 * PAGING IS NOT OPTIONAL. This RPC rejects any span over 1000 blocks outright, and
 * a 6-Leg 60s Plan is ~3,600 blocks long, so a single wide query returns nothing
 * useful and a swallowed error looks exactly like an idle chain. The cursor only
 * ever moves forward; the one backfill at mount is bounded by the Plan's own age.
 *
 * @param onSettled fired once per Leg the moment a `LegSettled` log is first seen,
 *                  carrying `paidToOwner` — the collateral that actually reached the
 *                  owner's wallet, not an estimate.
 */
export function useFires(
  planBook: Address | undefined,
  planId: number | null,
  planStartSec: number | null,
  onSettled?: (legIndex: number, paidToOwner: bigint) => void,
): FireFeed {
  const [fires, setFires] = useState<Fire[]>([]);
  const [scheduledOpenMs, setScheduledOpenMs] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cursor = useRef<bigint | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const settled = useRef<Set<number>>(new Set());
  const settledCb = useRef(onSettled);
  settledCb.current = onSettled;

  useEffect(() => {
    if (!planBook || planId === null) { setFires([]); setScheduledOpenMs(null); return; }
    cursor.current = null;
    seen.current = new Set();
    settled.current = new Set();
    setFires([]); setScheduledOpenMs(null); setError(null);

    let stop = false;

    /**
     * @param replay the one-off backfill at mount. Settlements found there are
     *   recorded but NOT announced: a reload must not re-flash money that landed
     *   minutes ago. A flash means "this just happened", or it means nothing.
     */
    const ingest = (batch: Fire[], replay = false) => {
      const fresh = batch.filter((f) => !seen.current.has(f.hash));
      for (const f of fresh) seen.current.add(f.hash);
      for (const f of batch) {
        for (const e of f.events) {
          if (e.name === "OpenScheduled" && e.firesAtMillis) {
            setScheduledOpenMs((prev) => (prev === null || e.firesAtMillis! > prev ? e.firesAtMillis! : prev));
          }
          if (e.name === "LegSettled" && e.planId === planId && e.legIndex !== undefined
              && !settled.current.has(e.legIndex)) {
            settled.current.add(e.legIndex);
            if (!replay) settledCb.current?.(e.legIndex, e.paidToOwner ?? 0n);
          }
        }
      }
      if (fresh.length) {
        setFires((prev) => [...prev, ...fresh].sort((a, b) =>
          a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1));
      }
    };

    const tick = async () => {
      try {
        const head = await pub.getBlockNumber();
        if (cursor.current === null) {
          // One bounded backfill: only as far as this Plan has actually been alive.
          const ageSec = planStartSec ? Math.max(0, Date.now() / 1000 - planStartSec) : 0;
          let pages = BigInt(Math.ceil((ageSec * BLOCKS_PER_SEC) / Number(LOG_SPAN + 1n)) + 1);
          if (pages > MAX_BACKFILL_PAGES) pages = MAX_BACKFILL_PAGES;
          const span = pages * (LOG_SPAN + 1n);
          const from = head > span ? head - span : 0n;
          setScanning(true);
          const batch = await readFires(planBook, planId, from, head);
          if (stop) return;
          ingest(batch, true);
          cursor.current = head;
        } else if (head > cursor.current) {
          const batch = await readFires(planBook, planId, cursor.current + 1n, head);
          if (stop) return;
          ingest(batch);
          cursor.current = head;
        }
        setError(null);
      } catch (e) {
        // Surface it. A silent log failure here reads identically to an idle chain,
        // and that exact ambiguity has already shipped a wrong UI once.
        setError((e as Error).message.split("\n")[0]);
      } finally {
        if (!stop) setScanning(false);
      }
    };

    void tick();
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [planBook, planId, planStartSec]);

  return { fires, scheduledOpenMs, scanning, error };
}
