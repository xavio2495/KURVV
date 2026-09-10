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
 * OFF BY DEFAULT while the two paths are being compared. Every step of the
 * migration is meant to be independently revertible, and a flag is the cheapest
 * revert there is — the harness in `scripts/` runs both paths against the same
 * instant and diffs the Window they choose, which is only possible while both
 * exist.
 */
export const USE_SDK = process.env.NEXT_PUBLIC_DREAMDEX_SDK === "1";
