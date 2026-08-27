import "./globals.css";
import { Providers } from "./providers";

export const metadata = { title: "KURVV", description: "Draw the market. The chain trades it." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
