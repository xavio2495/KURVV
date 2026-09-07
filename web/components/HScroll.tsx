import { Scene } from "./landing/Scene";
import { PixelNav } from "./PixelNav";

/**
 * The horizontal shell every page but `/legal` is built on.
 *
 * One tall rail, one sticky viewport-sized window, and a track of full-viewport
 * panels translated on X by `--evo`. You scroll down; the world moves left. Input
 * stays entirely conventional — wheel, trackpad, keyboard, touch, the scrollbar and
 * `#anchor` links all behave as they do on any page.
 *
 * `panels` sizes both the rail and the track, so the scroll length and the travel
 * can never disagree. `offset` picks where in the six-viewport level this page
 * starts, which is what makes `/pitch` a different place from `/board` rather than
 * the same opening stretch shown again.
 *
 * `/legal` is deliberately excluded: it is a long legal document, and paging one
 * viewport at a time through terms someone may need to search or print would be
 * hostile.
 */
export function HScroll({
  panels,
  offset = 0,
  className = "",
  children,
  chrome,
}: {
  panels: number;
  offset?: number;
  className?: string;
  children: React.ReactNode;
  chrome?: React.ReactNode;
}) {
  return (
    <main className={`hs ${className}`} style={{ "--hs-n": panels } as React.CSSProperties}>
      <div className="hs-rail">
        <div className="hs-vp">
          <Scene panels={panels} offset={offset} />
          <div className="hs-track">{children}</div>
          {chrome}
          <div className="hs-prog" aria-hidden />
        </div>
      </div>
      <PixelNav />
    </main>
  );
}
