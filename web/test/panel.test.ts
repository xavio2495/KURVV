import { test } from "node:test";
import assert from "node:assert/strict";
import { MAIN_H, PANEL_ROWS, optionBox, optionAtUV } from "../lib/screen.ts";

/**
 * The settings panel's layout, checked as arithmetic.
 *
 * Both defects these cover were pure geometry — a row list sized for six rows that
 * grew a seventh, and a dropdown sized for a handful of options that grew to twelve.
 * Neither throws, neither fails a type check, and both are invisible until someone
 * connects a wallet and opens the right row. So they are asserted rather than eyeballed.
 */

/** WALLET, NAME, STAKE, LEGS, WINDOW, TOKEN, SKIN — NAME appears once connected. */
const ROWS = 7;
/** The button-hint footer is `fillRect(0, H - 92, W, 92)`. */
const FOOTER_TOP = MAIN_H - 92;

test("every settings row sits clear of the button-hint footer", () => {
  for (let i = 0; i < ROWS; i++) {
    const y = PANEL_ROWS.top + i * PANEL_ROWS.height;
    // The selection block is `fillRect(24, y - 34, W - 48, height - 14)`.
    const bottom = y - 34 + PANEL_ROWS.height - 14;
    assert.ok(
      bottom <= FOOTER_TOP,
      `row ${i} ends at ${bottom}, under the footer at ${FOOTER_TOP}`,
    );
  }
});

test("the first row clears the title bar", () => {
  assert.ok(PANEL_ROWS.top - 34 > 90, "row 0 must not ride up into the header");
});

test("THE TRAP: a 12-option dropdown stays on the glass", () => {
  // NAME offers HANDLE_VARIANTS = 12 rerolls. At a fixed 62px row that is 760px on a
  // 780px surface, so the last options were drawn off-canvas AND at coordinates no
  // `v` in [0,1] can produce — invisible and untappable at once.
  for (let row = 0; row < ROWS; row++) {
    const box = optionBox(row, 12);
    assert.ok(box.y >= 0, `row ${row}: box starts at ${box.y}`);
    assert.ok(box.y + box.h <= MAIN_H, `row ${row}: box ends at ${box.y + box.h}`);
  }
});

test("every option in a long list is reachable by tap", () => {
  for (const count of [2, 3, 5, 7, 12]) {
    const box = optionBox(1, count);
    const seen = new Set<number>();
    // Sweep the full UV range the way a tap on the glass would.
    for (let step = 0; step <= 2000; step++) {
      const hit = optionAtUV(step / 2000, 1, count);
      if (hit >= 0) seen.add(hit);
    }
    for (let i = 0; i < count; i++) {
      assert.ok(seen.has(i), `option ${i} of ${count} is unreachable (box h=${box.h})`);
    }
  }
});

test("the hit test agrees with where the options are drawn", () => {
  const count = 12;
  const box = optionBox(1, count);
  for (let i = 0; i < count; i++) {
    // The renderer centres option `i` at `box.y + 8 + i * oh + oh / 2`.
    const centre = box.y + 8 + i * box.oh + box.oh / 2;
    const v = 1 - centre / MAIN_H;
    assert.equal(optionAtUV(v, 1, count), i, `option ${i} draws where it cannot be hit`);
  }
});
