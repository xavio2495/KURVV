import { PixelNav } from "../../components/PixelNav";

export const metadata = {
  title: "KURVV · legal",
  description: "Terms of use, privacy policy and licences for KURVV.",
};

/**
 * Terms, privacy and licences on one page.
 *
 * Everything here is a statement of fact about what this build actually does. The
 * licence section lists only grants that are recorded in the repository and were
 * checked against their source — an asset whose terms are not written down does not
 * get an entry invented for it.
 */
export default function Legal() {
  return (
    <>
      <main className="doc">
        <header className="doc-head">
          <p className="doc-kicker">Legal</p>
          <h1>Terms, privacy and licences</h1>
          <p className="doc-sub">
            KURVV is an experimental project built for a hackathon. It runs on the Somnia
            Shannon <strong>test</strong> network and settles in test tUSDC, a token with
            no monetary value that anyone can mint from its own faucet. Nothing here is a
            financial product.
          </p>
        </header>

        <section className="doc-sec">
          <h2>Terms of use</h2>

          <h3>What this is</h3>
          <p>
            KURVV turns a drawn curve into a schedule of dreamDEX Event Contract positions
            that a contract opens for you, one Window at a time. It is unaudited software
            written under a deadline, published so it can be looked at and tried. Use it on
            that basis or not at all.
          </p>

          <h3>Testnet only</h3>
          <p>
            Every position, balance and payout you will see is denominated in test tUSDC on
            chain <code>50312</code>. Test tokens are not money, cannot be exchanged for
            money, and can be minted freely by anyone. Gas is paid in STT, also a test
            token. <strong>Do not send mainnet assets to any address shown by this
            application.</strong>
          </p>

          <h3>No advice, no offer</h3>
          <p>
            Nothing on this site is investment, financial, legal or tax advice, and nothing
            here is an offer or solicitation to trade anything. A drawn curve is your own
            guess about a price. The application does not evaluate whether it is a good one.
          </p>

          <h3>What a Plan actually does with your stake</h3>
          <p>
            This is the part worth reading twice, because it is the honest limit of the
            design. A Reactivity handler is on-chain Solidity invoked by validators, so it
            cannot hold a key or sign as your wallet. The Plan contract therefore opens and
            owns the positions itself:
          </p>
          <ul>
            <li>
              You approve <strong>exactly the Plan&apos;s total stake</strong> and no more.
              The application never requests an unlimited allowance.
            </li>
            <li>
              For the life of the Plan, that stake is held by the Plan contract, which can
              only ever pay it back to you. Proceeds are owed to you by a contract rather
              than sitting in your wallet.
            </li>
            <li>
              Cancelling stops future Legs and returns whatever has not been deployed.
              Legs that have already settled are untouched.
            </li>
            <li>
              Redemption is permissionless — anyone may trigger the payout — but only the
              owner can receive it.
            </li>
          </ul>
          <p>
            If a chain of Legs stalls, your unspent stake is recoverable by cancelling. That
            is a property of the contract, not a promise of service.
          </p>

          <h3>Your keys, your responsibility</h3>
          <p>
            Wallets are handled by Privy. We never see, store or transmit a private key or a
            recovery phrase. If you lose access to your wallet, we cannot restore it.
          </p>

          <h3>No warranty</h3>
          <p>
            The software is provided <strong>as is</strong>, without warranty of any kind,
            express or implied. To the fullest extent permitted by law, the authors accept
            no liability for any loss or damage arising from its use, including loss of test
            tokens, failed or unfilled positions, chain reorganisations, indexer lag, or a
            Plan that stops advancing.
          </p>

          <h3>Availability</h3>
          <p>
            This is a demonstration. It may be taken down, redeployed or reset without
            notice, and testnet state may be wiped by the network itself at any time.
          </p>
        </section>

        <section className="doc-sec">
          <h2>Privacy policy</h2>

          <h3>What we collect: as close to nothing as we could manage</h3>
          <p>
            There is no account system, no sign-up form, no email list, and no analytics,
            tracking pixels or advertising on this site.
          </p>

          <h3>Stored in your browser</h3>
          <p>
            One key, <code>kurvv.handle.v1</code>, holding a map of wallet address to the
            display handle you picked for it. It is a number per address. It never leaves
            your device, and clearing site data removes it.
          </p>
          <p>
            Privy sets its own storage to keep you signed in to your embedded wallet. That
            is governed by Privy&apos;s privacy policy, not this one.
          </p>

          <h3>What is public because it is on a blockchain</h3>
          <p>
            Your wallet address, the Plans you commit, the positions they open and their
            outcomes are written to a public test network. They are visible to anyone, they
            are not written by us, and <strong>they cannot be deleted by us or by
            you</strong>. The leaderboard reads that public data. If you would rather not
            have activity tied to an address, use a fresh one.
          </p>

          <h3>Who we send data to</h3>
          <p>
            The application talks to the Somnia RPC endpoint, the dreamDEX Event Contract
            indexer, Privy, and the origin serving this page and its art. Requests to those
            carry the usual technical information a request carries, such as an IP address.
            We do not sell or share personal data, because we do not collect any to sell.
          </p>
        </section>

        <section className="doc-sec">
          <h2>Licences</h2>

          <h3>This project</h3>
          <p>
            KURVV&apos;s own source — the game, the console and the contracts — is
            published under the{" "}
            <a href="https://www.gnu.org/licenses/gpl-3.0.html">GNU General Public
            License v3.0 or later</a>. The full text is in the repository&apos;s{" "}
            <code>LICENSE</code> file, and every Solidity source carries a matching
            SPDX header.
          </p>

          <h3>Artwork</h3>
          <p>Two pixel-art packs, both public-domain dedications, both credited because the work deserves it:</p>
          <ul>
            <li>
              <strong>Flappy sprites</strong> — birds, skies, pipes and platform tiles by
              <strong> Megacrash</strong>, palette Endesga64. Released under{" "}
              <strong>CC0 1.0 Universal</strong>, stated in the pack&apos;s own
              <code>LICENSE.txt</code>, which ships here unmodified.
            </li>
            <li>
              <strong>fourSeasonsPlatformer_ tileset</strong> — terrain, seasons, props and
              the spinning coin, by <strong>Kevin&apos;s Mom&apos;s House</strong>. Released
              under <strong>CC0 1.0 Universal</strong> per the itch.io listing, checked
              5 September 2026. Attribution is optional there; it is given anyway.
            </li>
          </ul>
          <p>
            CC0 imposes no conditions, so nothing above is required of us. A per-file record
            of which sheets are actually loaded lives in the repository&apos;s
            <code>ATTRIBUTION.md</code> files, alongside each pack.
          </p>

          <h3>Typefaces</h3>
          <p>
            <strong>Silkscreen</strong> and <strong>Pixelify Sans</strong> are served
            locally by <code>next/font</code> under the SIL Open Font License. The KURVV
            wordmark is set in a display face licensed to the project.
          </p>

          <h3>Protocol</h3>
          <p>
            Event Contracts, the markets SDK and the Reactivity precompile belong to
            dreamDEX and Somnia respectively. KURVV is an independent client. It is not
            affiliated with, endorsed by, or operated by either.
          </p>

          <p className="doc-note">
            Questions about any of this, or a licence claim you think is wrong: raise an
            issue on the repository and it will be corrected.
          </p>
        </section>
      </main>
      <PixelNav />
    </>
  );
}
