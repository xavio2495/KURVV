import localFont from "next/font/local";
import { Silkscreen, Pixelify_Sans } from "next/font/google";
import "./globals.css";

/**
 * The two pixel faces the landing page morphs into. Self-hosted by `next/font`, so
 * there is no third-party request, no FOUT, and a `size-adjust` fallback that keeps
 * the crossfade in `Morph` from shifting layout before the face has decoded.
 *
 * Body copy never uses these. Pixel type at paragraph size is genuinely hard to
 * read, and the site is judged on user experience as well as presentation.
 */
const silkscreen = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--f-pix", display: "swap" });
const pixelify = Pixelify_Sans({ subsets: ["latin"], variable: "--f-pix-ui", display: "swap" });

/**
 * The display face, used for the wordmark and the top-level title on each page and
 * nothing else. Loaded through `next/font/local` rather than referenced from
 * `public/`, so it is hashed, preloaded and served with an immutable cache header —
 * a raw `@font-face` at a public URL is re-fetched and re-validated on every route.
 *
 * `display: "block"` here, not "swap": this face IS the logo, and a flash of the
 * fallback would show the wordmark in the wrong typeface as the first frame of the
 * page. The block period is short and the file is 12 kB.
 */
const nevera = localFont({
  src: "../public/Nevera-Regular.otf",
  variable: "--f-title",
  display: "block",
  weight: "400",
  style: "normal",
});

export const metadata = {
  title: "KURVV",
  description: "Draw the market. The chain trades it.",
  // `appleWebApp` is what lets iOS launch it full-screen from the home screen; iOS
  // ignores the manifest's display mode and reads these instead.
  appleWebApp: { capable: true, title: "KURVV", statusBarStyle: "black-translucent" as const },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon.png", type: "image/png", sizes: "1000x1000" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

/**
 * `viewport-fit=cover` plus a locked scale: the play surface is a device you press,
 * and a pinch-zoom or a double-tap zoom on a control reads as a broken button.
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover" as const,
  themeColor: "#0b0a12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nevera.variable} ${silkscreen.variable} ${pixelify.variable}`}>
      <body>{children}</body>
    </html>
  );
}
