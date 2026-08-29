import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "KURVV",
  description: "Draw the market. The chain trades it.",
  // `appleWebApp` is what lets iOS launch it full-screen from the home screen; iOS
  // ignores the manifest's display mode and reads these instead.
  appleWebApp: { capable: true, title: "KURVV", statusBarStyle: "black-translucent" as const },
  icons: {
    icon: [
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
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
