"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The site's navigation: a pixel plate pinned to the bottom centre.
 *
 * Every page except `/play` carries it. `/play` is a full-screen device with its own
 * controls, and a floating web nav over the glass would read as chrome bolted onto a
 * product that is pretending not to be a web page.
 *
 * The hardware view is deliberately not linked. It is a turntable for a 3D model —
 * useful while building, not something a visitor needs a door to.
 */
const LINKS = [
  { href: "/", label: "Home" },
  { href: "/play", label: "Play" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/board", label: "Board" },
  { href: "/pitch", label: "Pitch" },
  { href: "/legal", label: "Legal" },
];

export function PixelNav() {
  const path = usePathname();
  return (
    <nav className="pnav" aria-label="Site">
      {LINKS.map((l) => {
        const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={on ? "pnav-a on" : "pnav-a"} aria-current={on ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
