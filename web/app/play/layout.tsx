import { Providers } from "../providers";

/**
 * The wallet bridge lives here, not in the root layout.
 *
 * `Providers` mounts Privy through `next/dynamic` with `ssr: false`, and that opts
 * its whole subtree out of server rendering. Held at the root it did that to the
 * marketing pages too, which shipped them as an empty body — bad for anyone reading
 * the source and worse for anyone crawling it. `/play` is the only route that reads
 * a wallet, so the boundary belongs at `/play`.
 */
export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
