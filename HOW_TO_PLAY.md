# How to play KURVV

You are holding a small console. You draw a line on its screen, press one key, and
the chain places a series of real bets for you — one per time window, for as long as
your plan runs. Nobody has to be watching, including you.

This explains the one idea behind all of it, then the console, then each of the three
ways to play.

If you want to start right now: open `/play`, sign in, press the **pencil**, and drag
a line across the right-hand side of the screen. Everything below will make more sense
after that.

---

## The one idea

Every window — a minute, five minutes, an hour — the market asks one question:

> Will BTC be higher at the end of this window than the level it started from?

You are buying a **contract** on your answer. It pays **1.000000 tUSDC if you are
right** and **nothing if you are wrong**. So its price is simply the market's estimate
of your odds:

| You pay | The market thinks | You get back | That is |
|---|---|---|---|
| $0.85 | you are probably right | $1.00 | 1.2x |
| $0.50 | coin flip | $1.00 | 2x |
| $0.25 | you are the underdog | $1.00 | 4x |
| $0.10 | you are a long shot | $1.00 | 10x |

Nobody sets those prices. They come off a live order book, and a cheap contract is
the market telling you it does not fancy your chances — not a bargain.

**Two things worth knowing before you press anything:**

- **You cannot lose more than you staked.** There is no leverage and no liquidation.
  Stake $2 and $2 is the entire risk, forever.
- **One gesture is many bets.** A line across six windows is six separate positions,
  opened one at a time as each window arrives. You sign once, at the start.

### What makes this different from clicking "up" six times

The **shape** of your line decides how the money is split.

A segment that rises means UP for that window; a segment that falls means DOWN. And
the **steeper** the segment, the more of your stake goes on it. So a line that is flat
and then rips upward puts almost nothing on the flat part and most of the stake on the
rise — while a line that climbs steadily the whole way spreads the stake evenly. Both
end in the same place. They are not the same plan, and the money shows it.

---

## Getting in

1. **Open `/play` and sign in.** An email gets you a wallet created in the browser;
   "continue with a wallet" connects one you already have.
2. **Get gas.** A brand-new wallet has no STT and cannot pay for anything, so press
   the WALLET row again and it asks the app for a small top-up.
3. **Get tUSDC.** Press it once more and the token's own public faucet mints you
   **1,000 tUSDC**, straight to your wallet.

The WALLET row walks those three in order and only ever offers the next one you
actually need. It is all testnet money: it costs nothing and is worth nothing.

---

## The console

Two screens and a wheel. The **big screen** shows what is happening; the **small
green screen** shows what you have staked and which mode you are in.

| Control | What it does |
|---|---|
| **Centre key** (red) | The main action. On the chart it **commits your plan**; in a list it selects the row |
| **Pencil** (bottom) | Arms drawing — press it, then drag on the big screen |
| **Person** (top) | Standings, then the feed of transactions nobody signed |
| **Token** (right) | Steps the asset: BTC → ETH → SOMI |
| **Back** (left) | Steps back, and **cancels a running plan** |
| **Gear** | Settings: stake, legs, window, name, skin, how to play |
| **Play** | Changes the mode: draw → grid → flappy |
| **Edge wheel** | Rolls the stake up and down |

On a keyboard: **Enter** or **Space** is the centre key, **↑ ↓** (or W/S) scroll,
**←** is back, **→** is the asset, **E** the pencil, **P** the person, **Q** swaps the
two screens, **M** changes mode.

On a phone: everything is tappable, including the settings rows on the big screen.
Hold it in **landscape** — portrait is blocked on purpose, because the console does
not fit.

### The settings worth setting

| Row | What it means |
|---|---|
| **STAKE** | The total for the whole plan — $0.50, $1, $2, $5 or $10. It is divided between the legs, not charged per leg |
| **LEGS** | How many windows the plan covers, 2 to 8 |
| **WINDOW** | How long each one lasts: 60 seconds, 5 minutes or 1 hour |
| **TOKEN** | BTC, ETH or SOMI |

**Rounds × window is how long your run lasts.** Six rounds on the 60-second window is
six minutes — the whole thing, start to payout, while you watch. Six on the 5-minute
window is half an hour.

> **Play the 60-second window.** It is the one that shows the game off: six rounds
> finish in six minutes, so you watch a whole run open, settle and pay out in one
> sitting. It rolls back to back all day.
>
> One quirk comes with it. A round only accepts *new* runs for about fifteen of its
> sixty seconds — any younger and nobody is quoting yet, any older and it would end
> before your transaction lands. So pressing commit sometimes waits a few seconds
> first, and just occasionally gives up and asks you to press again. That is the
> console refusing to put your first bet somewhere it cannot fill, which is better
> than losing the round. The 5-minute window is roomier if you would rather not wait.

---

# The three modes

All three produce exactly the same thing: a side and a size for each window. Pick the
one that suits how you think.

## Draw — the one to start with

1. **Press the pencil.**
2. **Drag a line to the right of the `NOW` marker.** The past is not for sale; only
   the future span is drawn on.
3. Watch the strip along the bottom: it fills in with one pip per leg, showing the
   side and size you just drew.
4. **Press the centre key to commit.**

What the line means:

- **Rising segment → UP** for that window. **Falling → DOWN.**
- **Steeper → bigger stake.** Conviction is the slope, normalised so the whole plan
  adds up to your stake exactly.
- **Each vertical band is one window.** The bands are the columns your line is cut
  into.

You can draw several lines; the newest one is the one that commits, and the older ones
stay as ghosts for comparison.

> **Flat-then-sharp and steadily-rising are different plans**, even when they end at
> the same price. If that were not true, the drawing would be decoration.

## Grid — when you want to skip a window

A lattice: one column per window, rows above and below a centre line.

1. **Press the pencil**, then tap or drag across the columns.
2. **Above the centre is UP, below is DOWN.**
3. **Distance from the centre is SIZE, not price.** The rows are conviction. They are
   not price levels, and there is no such thing as betting on a particular price here
   — every window has exactly one market asking one question.
4. **The centre row means SKIP.** Not a small bet: that window is simply not traded.

That last one is the reason grid mode exists. A drawn line always has a slope at every
boundary, so it always takes a position. A grid can sit one out.

Dragging back across a column corrects it rather than adding to it.

## Flappy — call them as they come

A bird flies through a long tail of real, already-finished windows at one window a
second, and you call each one just before it reaches the bird.

1. **Tap the top half** of the screen to call UP for the window ahead of the bird,
   **the bottom half** for DOWN. Arrow keys and the wheel work too.
2. A **gate** appears — a solid half-plane anchored at that window's reference level.
   Above the line is UP, below is DOWN; there is no gap to thread, because a gap would
   be a price band and this venue does not sell one.
3. **A called window locks.** Tapping again moves to the next uncalled one. You cannot
   watch the price for a second and then flip — that would be reacting, not
   forecasting, and it was possible until it was fixed.
4. Press the centre key to commit the round as a plan on the **next** windows.

Flying is a rehearsal against history: no wallet, no transaction, nothing written. The
score is `hit / resolved`, and a voided window counts as neither.

**The bird does not decide anything.** Where it appears to be is animation; the verdict
comes from the settled on-chain result. Those two agree except at an exact tie, which
happens about 2% of the time, and a tie is genuinely undetermined rather than a near
miss.

Flappy needs a window that publishes a reference level, so it works on the 60-second
and 5-minute venues and says so plainly on the 1-hour one.

---

## After you commit

This is the part that is unlike other trading apps: **you are finished.**

- **Leg 0 opens inside your commit transaction**, so a plan can never exist without
  its first position.
- **Every later leg opens by itself.** When a window rolls, Somnia's validators invoke
  the contract directly. There is no server of ours involved, and nothing to keep
  awake.
- **You are never asked to sign again.** Not per leg, not per window. Close the tab;
  it keeps running.
- **Winnings are forwarded per leg**, as each window resolves — not held to the end.
- **A losing leg pays nothing and costs only its stake.** A voided window pays both
  sides half.

You can watch it happen on the **person key**: the standings, and then the feed of
transactions nobody signed, counted live.

### Stopping, and getting money back

**Back cancels a running plan.** Legs that have already settled are untouched; only
future ones stop, and every unspent penny comes back — including when the chain has
stalled, which is the case that matters.

If a leg is **skipped** (the market had no quote on the side it needed, or the window
was too short by the time it landed), that leg's stake stays in the plan and comes back
the same way, with cancel. Press it on a finished plan too; it is safe.

---

## Reading the two screens

**Big screen** — press the person key to cycle it: the chart, then the standings, then
the autonomy feed. The gear brings up the settings list, and HOW TO PLAY there is a
shorter version of this page, on the device itself.

**Small green screen** — while you are drawing it shows STAKE, BALANCE and LEGS, and
the mode in large letters along the bottom. When the big screen is showing something
else, it shows the market. The strip of pips is your plan: one per leg, lighting up as
each one opens, settles, wins or voids.

---

## Honest warnings

- **This is testnet.** The money is free and worthless, and the wallet is a burner.
- **Thin liquidity is normal.** If the book has no quote on the side you need, the
  console refuses instead of burning the leg. That is the system working.
- **A big multiple is not a gift.** 10x means the market gives you roughly a 1-in-10
  chance, and it is usually right.
- **The plan is committed to one asset and one window.** Changing either clears what
  you have drawn, rather than quietly re-aiming your gesture at a different market.
