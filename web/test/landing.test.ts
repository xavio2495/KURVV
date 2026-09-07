import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ramp, window4, AT, SECTIONS } from "../lib/landing/evolution.ts";
import { ZONES, ZONES_N, zoneAt, zoneWeight } from "../lib/landing/zones.ts";
import { ARCS, HERO_PROPS, PLATFORMS, PLATS, PROPS, hash } from "../lib/landing/level.ts";
import { GROUND_FRAC } from "../lib/landing/world.ts";
import { attractChart, attractFlappy, CYCLE, priceAt } from "../lib/landing/attract.ts";

/** A stand-in palette: these tests are about the DATA, never about the colours. */
const THEME = {
  backdrop: "neon", future: "#000", line: "#fff", glow: "#fff",
  grid: "#fff", edge: "#fff", plate: "#000", lattice: "#fff",
} as const;

const css = () => readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("ramp is clamped at both ends and smooth between", () => {
  assert.equal(ramp(-1, 0, 1), 0);
  assert.equal(ramp(0, 0, 1), 0);
  assert.equal(ramp(1, 0, 1), 1);
  assert.equal(ramp(2, 0, 1), 1);
  assert.equal(ramp(0.5, 0, 1), 0.5);
  // Smoothstep, not linear: the quarter point sits below the line.
  assert.ok(ramp(0.25, 0, 1) < 0.25);
});

test("a zero-width ramp does not divide by zero", () => {
  assert.equal(ramp(0.4, 0.5, 0.5), 0);
  assert.equal(ramp(0.5, 0.5, 0.5), 1);
});

test("window4 rises, holds at full, then falls", () => {
  assert.equal(window4(0, 0.2, 0.3, 0.7, 0.8), 0);
  assert.equal(window4(0.5, 0.2, 0.3, 0.7, 0.8), 1);
  assert.equal(window4(1, 0.2, 0.3, 0.7, 0.8), 0);
});

test("there is one zone per section, and each is centred on its panel", () => {
  assert.equal(ZONES.length, ZONES_N);
  assert.equal(SECTIONS.length, ZONES_N);
  // Panel i is dead centre when the track has travelled i of its n-1 steps. If this
  // drifts from the CSS transform the world and the copy describe different places.
  SECTIONS.forEach((key, i) => {
    assert.equal(AT[key], i / (ZONES_N - 1), `${key} is not centred on panel ${i}`);
    assert.equal(zoneWeight(i, i), 1, `zone ${i} is not at full strength on its own panel`);
  });
});

test("zone weights always sum to exactly one", () => {
  // A dip below 1 anywhere shows through as the flat backdrop colour halfway
  // between two worlds, which reads as a flash rather than as a crossfade.
  for (let at = 0; at <= ZONES_N - 1 + 1e-6; at += 0.083) {
    let sum = 0;
    for (let i = 0; i < ZONES_N; i++) sum += zoneWeight(Math.min(ZONES_N - 1, at), i);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum} at world position ${at}`);
  }
});

test("every zone owns exactly one viewport of world, in order", () => {
  const W = 1000;
  for (let i = 0; i < ZONES_N; i++) {
    assert.equal(zoneAt(i * W, W), i);
    assert.equal(zoneAt((i + 0.99) * W, W), i);
  }
  // Off both ends, rather than indexing past the table.
  assert.equal(zoneAt(-500, W), 0);
  assert.equal(zoneAt(99 * W, W), ZONES_N - 1);
});

test("every placed piece names a sprite that exists", () => {
  // A typo in the level table is a silently missing platform, not an error.
  for (const p of PLATFORMS) assert.ok(PLATS[p.k], `no platform sprite "${p.k}"`);
  for (const h of HERO_PROPS) assert.ok(PROPS[h.k], `no prop "${h.k}"`);
});

test("the level spans the whole world and leaves no empty panel", () => {
  for (let panel = 1; panel < ZONES_N; panel++) {
    const here = PLATFORMS.filter((p) => p.x >= panel - 0.1 && p.x < panel + 1.1);
    assert.ok(here.length >= 4, `panel ${panel} has only ${here.length} pieces`);
  }
});

test("materials interleave rather than switching at a seam", () => {
  // The point of the rebuild: you must not be able to point at an x and say the
  // theme changed THERE. Every interior panel mixes materials that also appear in
  // its neighbours.
  const keysIn = (panel: number) =>
    new Set(PLATFORMS.filter((p) => p.x >= panel && p.x < panel + 1).map((p) => p.k));
  for (let panel = 1; panel < ZONES_N - 1; panel++) {
    const a = keysIn(panel);
    const b = keysIn(panel + 1);
    const shared = [...a].filter((k) => b.has(k));
    assert.ok(shared.length > 0, `panels ${panel} and ${panel + 1} share no material`);
  }
});

test("the mountain climbs monotonically to the right", () => {
  const slope = PLATFORMS.filter((p) => p.z === 1 && p.x >= 5 && p.x <= 6.2 && p.y > 0.4 && p.y < 1.05)
    .sort((a, b) => a.x - b.x);
  assert.ok(slope.length >= 5, "the mountain has too few treads to read as a slope");
  for (let i = 1; i < slope.length; i++) {
    assert.ok(slope[i].y <= slope[i - 1].y, `tread ${i} drops instead of climbing`);
  }
  // And the summit has to be where the device stands.
  assert.ok(Math.abs(slope[slope.length - 1].y - GROUND_FRAC) < 0.05, "the summit is not at --lp-ground");
});

test("the level is placed deterministically", () => {
  // Scattered props are hashed from the platform index, so the world is identical
  // on every load and in every screenshot.
  assert.equal(hash(7), hash(7));
  assert.notEqual(hash(7), hash(8));
  for (const a of ARCS) assert.ok(a.n >= 3 && a.sag > 0, "a coin arc is degenerate");
});

test("the CSS ground line matches the canvas ground line", async () => {
  // The canvas is viewport-fixed and the device is in flow. This one number is all
  // that keeps the device standing ON the ground rather than above or inside it.
  const m = (await css()).match(/--lp-ground:\s*([\d.]+)%/);
  assert.ok(m, "--lp-ground is missing from globals.css");
  assert.equal(Number(m[1]) / 100, GROUND_FRAC);
});

test("the horizontal track travels exactly one panel per section", async () => {
  const s = await css();
  // The rail is what makes the scroll long enough; the transform is what turns it
  // sideways. If either loses `--lp-n` the world stops lining up with the copy.
  assert.match(s, /\.hs-rail\s*\{[^}]*height:\s*calc\(var\(--hs-n\) \* 100vh\)/);
  assert.match(s, /\.hs-track\s*\{[^}]*translate3d\(calc\(var\(--evo\) \* \(100vw - var\(--hs-n\) \* 100vw\)\)/);
  assert.match(s, /\.hs\s*\{\s*--hs-n:\s*6/);
});

test("BODY MUST NOT BE A SCROLL CONTAINER", async () => {
  const s = await css();
  // Any `overflow` other than `visible` on <body> makes it a scroll container, and
  // the sticky viewport then anchors to a scrollport that never moves — which
  // silently turns the side-scroller back into a plain tall page. This cost a
  // debugging session; it is one line and it will be re-added by accident.
  const body = s.match(/^\s*html,\s*body\s*\{[^}]*\}/gm) ?? [];
  for (const rule of body) {
    assert.doesNotMatch(rule, /overflow/, `overflow on <body> breaks the sticky viewport: ${rule}`);
  }
  assert.match(s, /\.hs-vp\s*\{[^}]*position:\s*sticky/);
});

test("the attract loops are pure functions of time, not of the clock", () => {
  // Same elapsed in, same picture out — on every load, in every screenshot and in
  // the demo video. That is the entire reason they are scripted rather than live.
  const a = attractChart("draw", 3.5, THEME);
  const b = attractChart("draw", 3.5, THEME);
  assert.deepEqual(a.buckets, b.buckets);
  assert.equal(a.now, b.now);
  assert.deepEqual(a.curves, b.curves);
  assert.equal(priceAt(1000), priceAt(1000));
  // And it must actually move between two different moments.
  assert.notDeepEqual(attractChart("draw", 0, THEME).curves, attractChart("draw", 9, THEME).curves);
});

test("draw mode has a Curve and no cells; grid mode the reverse", () => {
  const d = attractChart("draw", 6, THEME);
  assert.ok(d.curves && d.curves[0].length > 2);
  assert.equal(d.cells, null);
  const g = attractChart("pixel", 6, THEME);
  assert.equal(g.curves, null);
  assert.ok(g.cells && g.cells.some((c) => c !== undefined));
});

test("a settled attract frame has resolved Legs, not an empty board", () => {
  // The panels mount on a frame from mid-cycle. If that frame is empty the first
  // thing anyone sees — and every screenshot — is the least interesting one.
  const s = attractChart("draw", 8.2, THEME);
  assert.ok(s.legs.some((l) => l.state === "won" || l.state === "lost"), "no Leg has settled");
  assert.ok(s.legs.some((l) => l.state === "pending"), "every Leg has already settled");
  assert.ok(s.synthetic > 0, "no validator fires to show");
});

test("the flappy view is anchored on the WALL clock", () => {
  // `flappyScene` computes its head column as `headAt(startedAt, Date.now())`. An
  // anchor taken from `performance.now()` is off by the whole unix epoch and parks
  // every gate about 1.7 billion columns off the left of the frame.
  const v = attractFlappy(5).view;
  assert.ok(v);
  const head = (Date.now() - v.startedAt) / 1000;
  assert.ok(head >= 0 && head < 60, `head column is ${head}; anchor is on the wrong clock`);
  assert.ok(v.gates.length > v.span, "fewer gates than fit across the frame");
});

test("the attract cycle resolves gates as the bird passes them", () => {
  const early = attractFlappy(0.2).view!.gates.filter((g) => g.verdict !== "pending").length;
  const late = attractFlappy(CYCLE * 0.9).view!.gates.filter((g) => g.verdict !== "pending").length;
  assert.ok(late > early, "no gate ever resolves");
});

test("the pixel face is a pseudo-element, so the text exists exactly once", async () => {
  // The first version stacked two REAL text nodes per character. Everything that
  // reads a page as text — scrapers, agents, copy-paste, search — got every letter
  // twice: "OOnnee ggeessttuurree". The pixel glyph must stay in CSS.
  const s = await css();
  assert.match(s, /\.lp-ch::after\s*\{[^}]*content:\s*attr\(data-ch\)/);

  const src = await readFile(new URL("../components/landing/Morph.tsx", import.meta.url), "utf8");
  assert.equal((src.match(/>\{ch\}</g) ?? []).length, 1);

  // AND the letter box must not be inline-grid or inline-flex. Chrome's innerText
  // puts every child of one on its own LINE, so the headline reads back as
  // "O\nn\ne\n \ng\ne..." to anything using innerText — which is most readers and
  // agents. textContent stays correct either way, which is why this hides.
  const ch = s.match(/\.lp-ch\s*\{[^}]*\}/);
  assert.ok(ch, ".lp-ch rule is missing");
  assert.doesNotMatch(ch[0], /display:\s*inline-(grid|flex)/);
  assert.match(ch[0], /display:\s*inline-block/);
  // Words separated by a real space character, not by a CSS gap: a margin is not a
  // space, and the words ran together for anything reading the text.
  assert.match(src, /\{w > 0 \? " " : null\}/);
  assert.doesNotMatch(s, /\.lp-word \+ \.lp-word/);
});

test("a flipped mode panel swaps its grid TRACKS, not just the order", async () => {
  // `order` reorders the content but leaves the column widths where they were, so
  // the flipped panel handed the wide column to the board and squeezed the copy.
  const s = await css();
  assert.match(s, /\.lp-flip\s*\{[^}]*grid-template-columns:/);
  assert.match(s, /\.lp-flip \.lp-copy\s*\{[^}]*order:/);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /lp-mode lp-flip/);
});

test("every mode panel paints before its observer fires", async () => {
  // IntersectionObserver callbacks are delivered in the rendering step, which a
  // hidden or occluded tab skips — a panel that only draws from the observer stays
  // an empty bordered box.
  const src = await readFile(new URL("../components/landing/ModePlay.tsx", import.meta.url), "utf8");
  const mount = src.indexOf("paint(SETTLED)");
  const observe = src.indexOf("new IntersectionObserver");
  assert.ok(mount > 0 && observe > mount, "the first paint must precede the observer");
});

test("no plate uses a gradient behind text", async () => {
  // A soft radial darkening behind the copy read as a shadow laid over the picture
  // rather than as an object in it, and dragged the whole page's contrast down.
  // Plates are FLAT: one fill, one hard border, one offset shadow.
  const s = await css();
  const plates = s.match(/\.(lp-copy|lp-play|pnav|doc-sec)\s*\{[^}]*\}/g) ?? [];
  assert.ok(plates.length >= 4, "the plate rules are missing");
  for (const rule of plates) {
    assert.doesNotMatch(rule, /background:[^;]*gradient/, `a plate uses a gradient: ${rule.slice(0, 60)}`);
  }
});

test("the billboard frame and its screen are the same element", async () => {
  // A frame drawn on the canvas behind a separately-positioned screen never stayed
  // in register. The border belongs to the element that contains the canvas.
  const s = await css();
  const play = s.match(/\.lp-play\s*\{[^}]*\}/);
  assert.ok(play, ".lp-play rule is missing");
  assert.match(play[0], /border:/);
  const src = await readFile(new URL("../components/landing/ModePlay.tsx", import.meta.url), "utf8");
  assert.match(src, /<figure className="lp-play">[\s\S]*<canvas/);
});

test("the site nav reaches every public page and hides the hardware view", async () => {
  const nav = await readFile(new URL("../components/PixelNav.tsx", import.meta.url), "utf8");
  for (const href of ["/", "/play", "/how-it-works", "/board", "/pitch", "/legal"]) {
    assert.ok(nav.includes(`"${href}"`), `nav is missing ${href}`);
  }
  assert.doesNotMatch(nav, /"\/device"/, "the hardware view must not be linked");

  // And nothing else may link it either.
  for (const f of ["../app/page.tsx", "../app/pitch/page.tsx", "../app/board/page.tsx", "../app/how-it-works/page.tsx"]) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /href="\/device"/, `${f} still links the hardware view`);
  }
});

test("every scrolling page leaves room for the fixed nav", async () => {
  // The nav is pinned to the bottom centre. Without clearance the last line of a
  // page sits behind it, which is invisible until someone scrolls to the end.
  const s = await css();
  for (const sel of [".doc", ".page", ".pitch"]) {
    const rule = s.match(new RegExp(`\\${sel} \\{[^}]*\\}`));
    assert.ok(rule, `${sel} rule is missing`);
    const pad = rule[0].match(/padding:[^;]*?(\d+)px;/);
    assert.ok(pad && Number(pad[1]) >= 110, `${sel} has too little bottom padding for the nav`);
  }
});

test("every horizontal page sizes its rail from its own panel count", async () => {
  // The rail's height and the track's width both derive from `--hs-n`, so a page
  // that sets the wrong count gets a scroll length that disagrees with its travel —
  // the last panel becomes unreachable, or the world stops before the page does.
  const pages: [string, number][] = [
    ["../app/page.tsx", 6],
    ["../app/board/page.tsx", 2],
  ];
  for (const [f, n] of pages) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    const panels = src.match(/panels=\{(\d+)\}/);
    assert.ok(panels, `${f} does not set panels`);
    assert.equal(Number(panels[1]), n, `${f} declares the wrong panel count`);
    const sections = (src.match(/className="hs-panel/g) ?? []).length;
    assert.equal(sections, n, `${f} has ${sections} panels but declares ${panels[1]}`);
  }
});

test("/pitch is a stepped deck; the other pages ride the scroll shell", async () => {
  const pitch = await readFile(new URL("../app/pitch/page.tsx", import.meta.url), "utf8");
  assert.match(pitch, /<Deck>/, "/pitch must use the stepped deck");
  assert.doesNotMatch(pitch, /HScroll/, "/pitch must not also use the scroll shell");

  for (const f of ["../app/page.tsx", "../app/board/page.tsx", "../app/how-it-works/page.tsx"]) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    assert.match(src, /HScroll/, `${f} is not on the horizontal shell`);
  }

  // A long legal document paged one viewport at a time, that someone may need to
  // search or print, would be hostile.
  const legal = await readFile(new URL("../app/legal/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(legal, /HScroll|<Deck>/);
});

test("no page travels off the end of the level", async () => {
  // `offset + panels - 1` is the last world column a page reaches. The level is
  // authored out to x = 6; past that a page scrolls into empty sky.
  const files = ["../app/page.tsx", "../app/board/page.tsx", "../app/how-it-works/page.tsx"];
  for (const f of files) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    const p = src.match(/panels=\{([^}]+)\}/);
    const o = src.match(/offset=\{(\d+)\}/);
    const offset = o ? Number(o[1]) : 0;
    // `panels` may be an expression; only check the literal cases.
    if (!p || !/^\d+$/.test(p[1])) continue;
    assert.ok(offset + Number(p[1]) - 1 <= ZONES_N, `${f} travels past the end of the level`);
  }
});

test("there is exactly one deck scene per slide", async () => {
  const { SCENES } = await import("../lib/deck/scenes.ts");
  const src = await readFile(new URL("../app/pitch/page.tsx", import.meta.url), "utf8");
  const slides = (src.match(/kicker:/g) ?? []).length;
  // Hero plus one per SLIDES entry. A mismatch leaves a slide on a black frame or
  // a scene nobody ever reaches.
  assert.equal(SCENES.length, slides + 1, `${SCENES.length} scenes for ${slides + 1} slides`);
  assert.equal(new Set(SCENES.map((s) => s.key)).size, SCENES.length, "duplicate scene keys");
});

test("every deck scene is a finished place, not a fade-up", async () => {
  const { SCENES } = await import("../lib/deck/scenes.ts");
  for (const s of SCENES) {
    // The landing page builds from black; a deck slide must arrive complete.
    assert.ok(s.bands.length > 0, `${s.key} has no backdrop`);
    assert.ok(s.slabs.length > 0, `${s.key} has no platforms`);
    assert.ok(s.items.length > 0, `${s.key} has no props`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(s.wash), `${s.key} has no flat wash to load against`);
    for (const b of s.bands) assert.ok(b.alpha === undefined || b.alpha > 0.2, `${s.key} has a near-invisible band`);
  }
});

test("the deck scenes between them use the art the rest of the site does not", async () => {
  const { SCENES } = await import("../lib/deck/scenes.ts");
  const srcs = SCENES.flatMap((s) => [...s.bands.map((b) => b.src), s.ground?.src ?? ""]);
  // Each slide was given its own pack; these three are used nowhere else in the app.
  for (const want of ["spring_", "autumn_", "Background8"]) {
    assert.ok(srcs.some((u) => u.includes(want)), `no deck scene uses ${want}`);
  }
});

test("one wheel gesture advances exactly one slide", async () => {
  // A trackpad emits a long momentum tail from a single flick. Without a lockout
  // that one gesture walks through four slides.
  const src = await readFile(new URL("../components/Deck.tsx", import.meta.url), "utf8");
  assert.match(src, /STEP_LOCK\s*=\s*\d{3}/);
  assert.match(src, /if \(now < locked\.current\) return;/);
  // And the arrow keys must be handled, not just the wheel.
  for (const k of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.ok(src.includes(k), `the deck does not handle ${k}`);
  }
});

test("the share card counts only SETTLED legs", async () => {
  // Counting an open position as a loss reports a result that has not happened yet.
  const src = await readFile(new URL("../app/play/page.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(l\.state !== "won" && l\.state !== "lost" && l\.state !== "void"\) continue;/);
  assert.match(src, /net: paid - staked/);
});

test("the share dialog offers copy, download and share", async () => {
  const src = await readFile(new URL("../components/ShareCard.tsx", import.meta.url), "utf8");
  // An image on the clipboard needs a real ClipboardItem; writeText would put the
  // string "[object Blob]" there.
  assert.match(src, /new ClipboardItem\(\{ "image\/png": blob \}\)/);
  assert.match(src, /a\.download = "kurvv\.png"/);
  assert.match(src, /navigator\.share\(\{ files: \[file\]/);
  // Share must fall back rather than dead-end where the API is missing.
  assert.match(src, /if \(!nav\.canShare\?\.\(\{ files: \[file\] \}\)\) \{\s*download\(\);/);
});

test("the card is a fixed size, so it is the same picture everywhere", async () => {
  const { CARD_W, CARD_H } = await import("../lib/share/card.ts");
  assert.equal(CARD_W, 1200);
  assert.equal(CARD_H, 675);
  const src = await readFile(new URL("../lib/share/card.ts", import.meta.url), "utf8");
  // Nothing on the card has a knowable length — a generated handle, a net return
  // that may be six figures — so every string shrinks to its column rather than
  // clipping or overlapping its neighbour.
  assert.match(src, /while \(size > 14 && g\.measureText\(text\)\.width > room\)/);
  assert.match(src, /fit\(name, CARD_W - M \* 2/);
  assert.match(src, /fit\(value, col - 18/);
  // And a slow sheet must not hang the dialog open on a blank canvas.
  assert.match(src, /window\.setTimeout\(finish, \d+\)/);
});

test("the landscape rail anchors its two stacks to opposite ends", async () => {
  // They were pinned 8px and 64px from the top, which held only while both were
  // unstyled boxes. Once each became a bordered plate the first grew past 64px and
  // sat on the second. Opposite ends means their heights cannot collide.
  const s = await css();
  const block = s.match(/@media \(orientation: landscape\) and \(max-height: 560px\) \{[\s\S]*?\n\}/);
  assert.ok(block, "the landscape rail block is missing");
  const hud = block[0].match(/\.play-hud \{[^}]*\}/);
  const act = block[0].match(/\.play-actions \{[^}]*\}/);
  assert.ok(hud && act, "the rail no longer positions both stacks");
  assert.match(hud[0], /top:/);
  assert.match(act[0], /bottom:/);
  assert.match(act[0], /top:\s*auto/);
});

test("a status sentence is never squeezed into the rail", async () => {
  // At 58px wide "No BTC market is open on the 60 second window right now." ran to
  // nine lines, one word each.
  const s = await css();
  const block = s.match(/@media \(orientation: landscape\) and \(max-height: 560px\) \{[\s\S]*?\n\}/);
  assert.ok(block);
  const status = block[0].match(/\.play-status, \.play-tx \{[^}]*\}/);
  assert.ok(status, "the landscape status rule is missing");
  assert.match(status[0], /left:\s*var\(--rail\)/);
  assert.doesNotMatch(status[0], /max-width:\s*\d+px/);
});

test("the landing footer clears the fixed nav on a phone", async () => {
  // The nav is fixed bottom-centre; without clearance it sits straight on the
  // footer line, which is how it shipped to a real phone.
  const s = await css();
  const phone = s.match(/@media \(max-width: 860px\) \{[\s\S]*?\n\}/);
  assert.ok(phone, "the phone breakpoint is missing");
  const foot = phone[0].match(/\.lp-foot \{[^}]*\}/);
  assert.ok(foot, "the phone footer rule is missing");
  assert.match(foot[0], /bottom:\s*calc\(\d+px \+ env\(safe-area-inset-bottom\)\)/);
});

test("the level scales down on a narrow viewport", async () => {
  // Every placement is a fraction of viewport WIDTH, so a slab that reads as one
  // platform among many on a desktop is a third of a phone screen.
  const src = await readFile(new URL("../lib/landing/world.ts", import.meta.url), "utf8");
  assert.match(src, /const gauge = \(\) =>/);
  assert.match(src, /p\.s \* W \* gauge\(\)/);
  assert.match(src, /p\.h \* H \* gauge\(\)/);
});
