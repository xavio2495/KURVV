"use client";
import { Fragment } from "react";

/**
 * A line of text that turns to pixel type one letter at a time as you scroll.
 *
 * Each character owns its own slice of the transition, staggered left to right, so
 * the headline converts like something being retyped rather than dissolving as a
 * block.
 *
 * ONLY ONE COPY OF THE TEXT IS IN THE DOM. A font cannot be interpolated, so the
 * effect needs two glyphs per character — but the pixel one is a `::after` carrying
 * `content: attr(data-ch)`, which is invisible to `textContent`, `innerText`,
 * copy-paste, scrapers and anything else reading the page as text. The earlier
 * version made both copies real text nodes and every reader got
 * "OOnnee ggeessttuurree" for its trouble.
 *
 * For the same reason the words are separated by REAL space characters rather than
 * by margin: a CSS gap is not a space, and a heading whose words run together is
 * worse than one in the wrong font.
 */

/** Share of the window spent staggering. The rest is one letter's own crossfade. */
const STAGGER = 0.72;

export function Morph({
  children,
  from,
  to,
  as: Tag = "span",
  className = "",
}: {
  children: string;
  /** `evo` at which the first letter starts turning. */
  from: number;
  /** `evo` by which the last letter has finished. */
  to: number;
  as?: "h1" | "h2" | "h3" | "span" | "p";
  className?: string;
}) {
  const span = to - from;
  const letters = [...children].filter((c) => c !== " ").length;
  let seen = 0;

  return (
    // The label is what assistive tech announces. Chrome exposes `::after` content
    // to the accessibility tree, so without it a screen reader would hear the
    // doubling that a scraper no longer sees.
    <Tag className={`lp-morph ${className}`} aria-label={children}>
      {children.split(" ").map((word, w) => (
        <Fragment key={`${word}-${w}`}>
          {w > 0 ? " " : null}
          <span className="lp-word" aria-hidden>
            {[...word].map((ch, i) => {
              // Letters, not characters: spaces carry no glyph, so counting them
              // would leave dead time in the middle of the sweep.
              const t = letters > 1 ? seen++ / (letters - 1) : 0;
              const a = from + t * span * STAGGER;
              const style = { "--a": a, "--b": a + span * (1 - STAGGER) } as React.CSSProperties;
              return (
                <span className="lp-ch" data-ch={ch} style={style} key={`${ch}-${i}`}>
                  <span className="lp-ch-sans">{ch}</span>
                </span>
              );
            })}
          </span>
        </Fragment>
      ))}
    </Tag>
  );
}
