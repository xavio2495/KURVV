/**
 * The migration flag, and NOTHING else.
 *
 * Its own module on purpose. It lived in `config.ts` for one commit, and because
 * `config.ts` imports the SDK's address map and chain definitions, every module
 * that merely wanted to ask "is the SDK path on?" dragged those into the initial
 * bundle — 14 kB of /play's first load for one boolean. This file imports
 * nothing.
 */

/**
 * Route discovery through the SDK instead of the hand-written GraphQL.
 *
 * ON BY DEFAULT since 10 Sep 2026, after both paths were compared live and
 * agreed. The legacy path stays as the revert: set `NEXT_PUBLIC_DREAMDEX_SDK=0`
 * to fall back to it without touching code.
 */
export const USE_SDK = process.env.NEXT_PUBLIC_DREAMDEX_SDK !== "0";
