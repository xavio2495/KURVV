import type { MetadataRoute } from "next";

/**
 * Installable as an app.
 *
 * `display: "standalone"` is the point: launched from the home screen the device
 * fills the screen with no browser chrome, which is what makes a canvas that is
 * already full-bleed read as an application rather than a page. `/play` is the start
 * URL because the home page is the pitch and nobody installs a pitch.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KURVV — draw the market",
    short_name: "KURVV",
    description: "Draw a curve. The chain trades it, leg by leg, on its own.",
    start_url: "/play",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0a12",
    theme_color: "#0b0a12",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
