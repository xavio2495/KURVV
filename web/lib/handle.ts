/**
 * A trader's display name.
 *
 * Every address gets a handle without anyone having to type one: the name is derived
 * from the address itself, so the same wallet is the same trader on every device and
 * in every session, with nothing stored and nothing to sync. That is what makes a
 * leaderboard possible at all here — there is no account system to look names up in.
 *
 * The derivation is a plain FNV-1a over the address. It does not need to be a strong
 * hash; it needs to be *stable* and to spread evenly over the word lists, and a hash
 * with visible clustering would put half the board on the same adjective.
 */

const ADJECTIVES = [
  "swift", "gilded", "hollow", "candid", "brazen", "sable", "lucid", "feral",
  "quiet", "molten", "arctic", "velvet", "crooked", "tidal", "static", "amber",
  "hushed", "rogue", "opal", "flint", "vagrant", "cobalt", "solemn", "ragged",
  "nimble", "umber", "restless", "iron", "pallid", "sunken", "keen", "wired",
] as const;

const NOUNS = [
  "otter", "kestrel", "marlin", "lynx", "heron", "vulture", "ferret", "orca",
  "magpie", "jackal", "raven", "badger", "gannet", "cicada", "mantis", "adder",
  "shrike", "tapir", "ibex", "grouse", "pelican", "weasel", "condor", "civet",
  "osprey", "stoat", "hornet", "gecko", "puffin", "wombat", "narwhal", "dingo",
] as const;

/** FNV-1a, 32-bit. Deterministic across engines; no BigInt in the hot path. */
function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The handle for an address, optionally the `n`th alternative.
 *
 * `variant` exists so the owner can reroll their own name without a keyboard — the
 * device has a scroll wheel and no text entry, so "pick from a stable sequence" is
 * the only input method the hardware actually has.
 */
export function handleFor(address: string, variant = 0): string {
  const key = address.toLowerCase();
  const a = fnv1a(key, 0x811c9dc5 + variant * 0x9e3779b9);
  const b = fnv1a(key + ":n", 0x01000193 + variant * 0x85ebca6b);
  // `^` yields a SIGNED int32 in JS, and a negative left operand makes `%` negative
  // too — which shipped handles like "swift-mantis--18". Coerce back to unsigned.
  const n = (((a ^ (b >>> 7)) >>> 0) % 90) + 10;
  return `${ADJECTIVES[a % ADJECTIVES.length]}-${NOUNS[b % NOUNS.length]}-${n}`;
}

/** How many rerolls the wheel offers before it comes back round. */
export const HANDLE_VARIANTS = 12;

const KEY = "kurvv.handle.v1";

/** The owner's chosen variant, per address. Absent until they pick one. */
export function readHandleVariant(address: string): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, number>;
    const v = map[address.toLowerCase()];
    return typeof v === "number" ? v : null;
  } catch { return null; }
}

export function writeHandleVariant(address: string, variant: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[address.toLowerCase()] = variant;
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* a full or blocked store must not break the connect flow */ }
}
