"use client";

/**
 * The device's voice.
 *
 * Recorded button and roller sounds, decoded once and played through the Web Audio
 * graph rather than through `<audio>` elements: an `Audio()` per press costs a media
 * element and a decode each time, and its start latency is visible against a key you
 * are watching depress. A `BufferSource` starts on the next audio callback.
 *
 * Two details do most of the perceived-quality work:
 *
 *  - **Leading silence is trimmed at decode.** MP3 carries encoder delay, so the
 *    file's first sample is not its first sound. Playing from a measured offset is
 *    the difference between a key that clicks and a key that clicks a moment later.
 *  - **Repeats are detuned a few cents.** The same buffer fired twice in a row reads
 *    as a recording; a little random drift reads as a mechanism.
 *
 * Two sounds have no recording — the commit and a Leg settling — so those stay
 * synthesised from oscillators.
 */

type Ctx = AudioContext;

const DIR = "/sfx";

/** Every clip, with its level and how far repeats may drift, in cents. */
const CLIPS = {
  keyPress:   { src: [`${DIR}/key-press.mp3`],    gain: 0.9,  drift: 22 },
  keyRelease: { src: [`${DIR}/key-release.mp3`],  gain: 0.62, drift: 22 },
  padPress:   { src: [`${DIR}/pad-press.mp3`],    gain: 0.85, drift: 34 },
  padRelease: { src: [`${DIR}/pad-release.mp3`],  gain: 0.55, drift: 34 },
  actPress:   { src: [`${DIR}/action-press.mp3`], gain: 0.85, drift: 30 },
  actRelease: { src: [`${DIR}/action-release.mp3`], gain: 0.55, drift: 30 },
  detent:     { src: [`${DIR}/detent.mp3`],       gain: 0.75, drift: 0 },
  roller:     { src: [`${DIR}/roller.mp3`],       gain: 0.6,  drift: 40 },
  refused:    { src: [`${DIR}/refused.mp3`],      gain: 0.8,  drift: 0 },
  toggleOn:   { src: [`${DIR}/toggle-on.mp3`],    gain: 0.9,  drift: 0 },
  toggleOff:  { src: [`${DIR}/toggle-off.mp3`],   gain: 0.9,  drift: 0 },
  swipe:      { src: [1, 2, 3].map((i) => `${DIR}/swipe/swipe-${i}.mp3`), gain: 0.7, drift: 30 },
  tap:        { src: [1, 2, 3, 4, 5].map((i) => `${DIR}/tap/tap-${i}.wav`), gain: 0.5, drift: 45 },
} as const;

type ClipKey = keyof typeof CLIPS;

interface Sample { buffer: AudioBuffer; offset: number }

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let masterOf: Ctx | null = null;
let primed = false;

let enabled = true;
let volume = 1;
const BASE = 0.55;

/** Per-key rate limit. A held key or a fast scroll must not machine-gun. */
const RATE_MS = 34;
const lastAt = new Map<string, number>();
/** Which variant each multi-clip key played last, so it never repeats immediately. */
const lastVariant = new Map<ClipKey, number>();

const decoded = new Map<string, Sample>();
const pending = new Map<string, Promise<Sample | null>>();

function audio(): Ctx | null {
  if (typeof window === "undefined") return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  if (ctx && ctx.state === "closed") { ctx = null; master = null; }
  ctx ??= new C();
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return ctx;
}

function out(c: Ctx): GainNode {
  if (!master || masterOf !== c) {
    master = c.createGain();
    master.gain.value = BASE * volume;
    master.connect(c.destination);
    masterOf = c;
  }
  return master;
}

/** First sample above the noise floor, backed off slightly so no transient is cut. */
function firstSound(b: AudioBuffer): number {
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i]) > 0.002) return Math.max(0, (i - 8) / b.sampleRate);
  }
  return 0;
}

function load(c: Ctx, url: string): Promise<Sample | null> {
  const done = decoded.get(url);
  if (done) return Promise.resolve(done);
  const inflight = pending.get(url);
  if (inflight) return inflight;

  const p = fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => (buf ? c.decodeAudioData(buf) : null))
    .then((buffer) => {
      if (!buffer) return null;
      const s: Sample = { buffer, offset: firstSound(buffer) };
      decoded.set(url, s);
      return s;
    })
    .catch(() => null)
    .finally(() => pending.delete(url));

  pending.set(url, p);
  return p;
}

/** Decode everything once. Called on unlock, so no press waits on a network round trip. */
function prime(c: Ctx) {
  if (primed) return;
  primed = true;
  for (const clip of Object.values(CLIPS)) for (const src of clip.src) void load(c, src);
}

function pick(key: ClipKey): string {
  const { src } = CLIPS[key];
  if (src.length === 1) return src[0];
  const prev = lastVariant.get(key);
  let i = Math.floor(Math.random() * (prev === undefined ? src.length : src.length - 1));
  if (prev !== undefined && i >= prev) i++;
  lastVariant.set(key, i);
  return src[i];
}

function emit(c: Ctx, s: Sample, gain: number, cents: number, rate = 1) {
  const src = c.createBufferSource();
  src.buffer = s.buffer;
  src.playbackRate.value = rate;
  if (cents) src.detune.value = cents;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(out(c));
  src.start(0, s.offset);
}

/**
 * Play a clip. `rate` shifts pitch for sounds that carry a position, like the roller.
 * A clip that is not decoded yet is decoded and then played, but only if it lands
 * soon enough to still belong to the gesture that asked for it.
 */
function play(key: ClipKey, opts: { rate?: number; gain?: number } = {}) {
  if (!enabled) return;
  const c = audio();
  if (!c) return;
  const clip = CLIPS[key];
  const url = pick(key);
  const cents = clip.drift ? (Math.random() * 2 - 1) * clip.drift : 0;
  const gain = opts.gain ?? clip.gain;

  const ready = decoded.get(url);
  if (ready) { emit(c, ready, gain, cents, opts.rate ?? 1); return; }

  prime(c);
  const asked = performance.now();
  void load(c, url).then((s) => {
    if (s && performance.now() - asked < 320) emit(c, s, gain, cents, opts.rate ?? 1);
  });
}

function gate(key: string): boolean {
  if (!enabled) return false;
  const t = performance.now();
  if (t - (lastAt.get(key) ?? -Infinity) < RATE_MS) return false;
  lastAt.set(key, t);
  return true;
}

// ── the two sounds with no recording ────────────────────────────────────────
/** Triangle + sine an octave up, through a lowpass tracking the fundamental. */
function blip(c: Ctx, freq: number, at: number, dur: number, gain = 0.06) {
  const g = out(c);
  const body = c.createOscillator();
  const shim = c.createOscillator();
  const bg = c.createGain();
  const sg = c.createGain();
  const lp = c.createBiquadFilter();
  body.type = "triangle";
  shim.type = "sine";
  body.frequency.setValueAtTime(freq, at);
  shim.frequency.setValueAtTime(freq * 2.01, at);
  lp.type = "lowpass";
  lp.frequency.value = Math.min(freq * 5, 8500);
  bg.gain.setValueAtTime(1e-4, at);
  bg.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  bg.gain.exponentialRampToValueAtTime(1e-4, at + dur);
  sg.gain.setValueAtTime(1e-4, at);
  sg.gain.exponentialRampToValueAtTime(gain * 0.22, at + 0.006);
  sg.gain.exponentialRampToValueAtTime(1e-4, at + dur * 0.6);
  body.connect(lp).connect(bg).connect(g);
  shim.connect(sg).connect(g);
  body.start(at); body.stop(at + dur + 0.05);
  shim.start(at); shim.stop(at + dur + 0.05);
}

/** Which recording a key uses. The wheel, the pad and the quick actions differ. */
const KEY_CLIP: Record<string, [ClipKey, ClipKey]> = {
  authorise: ["keyPress", "keyRelease"],
  draw:      ["padPress", "padRelease"],
  cancel:    ["padPress", "padRelease"],
  asset:     ["padPress", "padRelease"],
  profile:   ["padPress", "padRelease"],
  swap:      ["actPress", "actRelease"],
  mode:      ["actPress", "actRelease"],
};

export const sfx = {
  setEnabled(v: boolean) {
    enabled = v;
    if (master) master.gain.value = v ? BASE * volume : 0;
  },
  setVolume(v: number) {
    volume = Math.min(1, Math.max(0, v));
    if (master && enabled) master.gain.value = BASE * volume;
  },
  /** Open the context inside a gesture — browsers refuse to start it otherwise — and
   *  decode every clip while the user is still reaching for the first control. */
  unlock() {
    const c = audio();
    if (c) prime(c);
  },

  press(id: string) {
    if (!gate(`p:${id}`)) return;
    play((KEY_CLIP[id] ?? KEY_CLIP.cancel)[0]);
  },
  release(id: string) {
    if (!gate(`r:${id}`)) return;
    play((KEY_CLIP[id] ?? KEY_CLIP.cancel)[1]);
  },

  /**
   * One detent of the roller.
   *
   * `step` is the position in the run, and it shifts the playback rate a little, so
   * the pitch climbs as the value does. A roller that sounds identical at both ends
   * tells you nothing about where you are.
   */
  detent(step: number, span = 8) {
    if (!gate("detent")) return;
    const k = Math.min(1, Math.max(0, step / Math.max(span, 1)));
    play("detent", { rate: 0.92 + k * 0.34 });
  },

  /** A refused key. A key that does nothing in silence reads as a broken one. */
  disabled() { if (gate("refused")) play("refused"); },

  /** A tap on the glass — picking a row, or finishing a stroke. */
  tap() { if (gate("tap")) play("tap"); },

  /** The displays trading places. */
  swap() { if (gate("swap")) play("swipe"); },

  /** A two-state switch: the mode key, and the 2D/3D toggle. */
  mode(on: boolean) { if (gate("mode")) play(on ? "toggleOn" : "toggleOff"); },

  stroke() { if (gate("stroke")) play("tap", { gain: 0.62 }); },

  /** The Plan going on-chain. The one sound allowed to be an event. */
  commit() {
    if (!gate("commit")) return;
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
      blip(c, f, t + 0.05 + i * 0.07, 0.4, 0.055));
    blip(c, 261.63, t, 0.9, 0.05);
    blip(c, 1567.98, t + 0.44, 0.5, 0.03);
  },

  /** A Leg resolving. Win rises, loss falls; neither is loud. */
  settle(won: boolean) {
    if (!gate(`settle:${won}`)) return;
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    if (won) { blip(c, 880, t, 0.13, 0.05); blip(c, 1318.5, t + 0.085, 0.2, 0.045); }
    else { blip(c, 330, t, 0.16, 0.04); blip(c, 247, t + 0.075, 0.24, 0.035); }
  },
};

if (typeof document !== "undefined") {
  // Mobile browsers suspend the context when the tab hides; nothing sounds after a
  // return unless it is resumed explicitly.
  const wake = () => { if (document.visibilityState === "visible" && ctx) void ctx.resume().catch(() => {}); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("pageshow", wake);
}
