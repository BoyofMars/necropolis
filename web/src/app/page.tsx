import Link from "next/link";
import { BRAND } from "@/brand";
import { HeroMechanic } from "@/components/landing/HeroMechanic";
import { LiveStats } from "@/components/landing/LiveStats";
import { FadingField, Reveal } from "@/components/landing/Reveal";
import { Pulse } from "@/components/Pulse";
import { syntheticBeats } from "@/lib/beats";
import { ButtonLink } from "@/components/ui";

const TICKERS =
  "HAWK LIBRA MELANIA MICHI SNAP BALD NORMIE FUMBLE HOPIUM COPIUM NGMI WENLAMBO RUGGED DEVSOLD CTO MOONRAT GIGACHAD2 PEPE3 SAFEMOON2 LUNA3 FROGE CATWIFHAT DOGEKILLER ELONCUM TRUMPGPT AIRUG HONK BONKERS SLOTH WAGMI2 SOLAPE BASEDOG FARTDAO GOBLIN NPC420 COPE SEND RIP FOMO EXIT LAMBO LADDER CHAD WOJAK BOBO PUMP DUMP LOL UPONLY NEXT1000X FUD CEO2 TATE2 MOGGED SIGMA SKIBIDI RIZZ OHIO GYATT TOAD BLOCKY STONK ZOOM"
    .split(" ");

export default function Landing() {
  return (
    <div>
      {/* HERO */}
      <section className="relative mx-auto max-w-[1200px] px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:pb-24">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div>
            <p className="eyebrow">A graveyard for dead memecoins · Solana &amp; Base · verified by NEAR</p>
            <h1 className="mt-5 font-display text-[3.4rem] font-semibold leading-[0.95] tracking-tight text-bone sm:text-[4.6rem] lg:text-[5.4rem]">
              Bury the bag.
              <br />
              <span className="italic text-bone-2">Keep the claim.</span>
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-bone-2">
              Send a dead memecoin to its own grave on Solana or Base, an address only NEAR can open. If the coin
              ever <em className="not-italic text-bone">genuinely</em> comes back, you get 80% of it back. The other 20% is
              shared by every grave still resting in the cemetery.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/scan" size="lg">
                Scan my wallet for the dead
              </ButtonLink>
              <ButtonLink href="/how" variant="ghost" size="lg">
                How it works
              </ButtonLink>
            </div>
            <div className="mt-10 border-t border-line pt-6">
              <LiveStats />
            </div>
          </div>
          <HeroMechanic />
        </div>
      </section>

      {/* SCENE 1 — DEATH */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
          <Reveal>
            <p className="eyebrow">I · The death toll</p>
            <h2 className="mt-4 max-w-3xl font-display text-4xl leading-tight text-bone sm:text-6xl">
              11.6 million memecoins stopped trading in 2025.
            </h2>
            <p className="mt-5 max-w-2xl text-bone-2">
              95% of pump.fun tokens never trade past day 90. 98.6% of Solana memecoins ended with less than $1,000 of
              liquidity. The coins die. The positions just sit there, as clutter.
            </p>
            <p className="mt-2 text-xs text-bone-4">Sources: CoinGecko research (2026), Solidus Labs (2025).</p>
          </Reveal>
          <div className="mt-12">
            <FadingField tickers={TICKERS} />
          </div>
        </div>
      </section>

      {/* SCENE 2 — THE WALLET */}
      <section className="border-t border-line bg-loam-1/40">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-2">
          <Reveal>
            <p className="eyebrow">II · Your wallet is a graveyard</p>
            <h2 className="mt-4 font-display text-4xl leading-tight text-bone sm:text-5xl">Paste a wallet. Meet your dead.</h2>
            <p className="mt-5 text-bone-2">
              The scanner reads every token in a Solana or Base wallet, checks its vital signs, and tells you which are
              alive, fading, critical or dead, and exactly why. Where the evidence is thin, it says so instead of
              guessing.
            </p>
            <div className="mt-8">
              <ButtonLink href="/scan" variant="ghost">
                Open the scanner
              </ButtonLink>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-[18px] border border-line bg-loam-1 p-5">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-3xl text-bone">23 tokens found</span>
                <span className="eyebrow">sample wallet</span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                {[
                  ["14", "dead", "var(--dead)"],
                  ["6", "critical", "var(--critical)"],
                  ["2", "fading", "var(--fading)"],
                  ["1", "alive", "var(--alive)"],
                ].map(([n, l, c]) => (
                  <div key={l} className="rounded-[10px] border border-line bg-loam-2 py-3">
                    <div className="font-display text-2xl" style={{ color: c }}>{n}</div>
                    <div className="eyebrow !text-[10px]">{l}</div>
                  </div>
                ))}
              </div>
              <ul className="mt-4 divide-y divide-line text-sm">
                {[
                  ["$HAWK", "Liquidity $1.2k · 235 days without a pulse", "89"],
                  ["$MICHI", "Volume 0.3% of peak · 244 days dead", "83"],
                  ["$LIBRA", "-99% from ATH · traders thinning", "72"],
                ].map(([s, why, score]) => (
                  <li key={s} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="font-semibold text-bone">{s}</div>
                      <div className="truncate text-xs text-bone-3">{why}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-xl text-dead">{score}</div>
                      <div className="text-[10px] uppercase tracking-wider text-bone-4">death score</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SCENE 3/4 — BURIAL, NO BRIDGE */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
          <Reveal>
            <p className="eyebrow">III · Bury, don&rsquo;t burn</p>
            <h2 className="mt-4 max-w-3xl font-display text-4xl leading-tight text-bone sm:text-5xl">
              Your token never leaves its chain. NEAR just holds the only key.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                n: "01",
                t: "A grave of your own",
                d: "Every burial gets a fresh address on Solana or Base, derived from the Necropolis contract through NEAR Chain Signatures. No one holds its private key, not even us.",
              },
              {
                n: "02",
                t: "A plain transfer",
                d: "You send the dead token to that address from the wallet you already use. One native transaction. No bridge, no wrapped token, no NEAR wallet, no gas token to buy.",
              },
              {
                n: "03",
                t: "Verified by NEAR's MPC",
                d: "NEAR's MPC network reads the deposit straight from Solana or Base and attests to it. Only then does the contract mint your grave: a position you own, keyed to your own wallet.",
              },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 0.08}>
                <div className="h-full rounded-[16px] border border-line bg-loam-1 p-6">
                  <div className="inscription text-sm text-bone-4">{s.n}</div>
                  <h3 className="mt-3 font-display text-2xl text-bone">{s.t}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-bone-2">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* SCENE 5/6 — RESURRECTION */}
      <section className="relative overflow-hidden border-t border-line bg-loam-1/40">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_1.1fr]">
          <Reveal>
            <p className="eyebrow">IV · Resurrection has rules</p>
            <h2 className="mt-4 font-display text-4xl leading-tight text-bone sm:text-5xl">
              A pump is not a pulse.
            </h2>
            <p className="mt-5 text-bone-2">
              A coin rises only if it sustains a real recovery for 14 consecutive days. That means $50k+ liquidity,
              volume back to 10% of its old peak, 100+ unique traders a day, 5× its burial market cap, no wash-trading
              signature, and agreement between independent data sources. One bad day is a false dawn, and the count
              starts again.
            </p>
            <p className="mt-4 text-bone-2">
              Coroners only <em>report</em> the numbers. The NEAR contract applies the rule, with terms that were frozen
              when the first grave was dug.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-[18px] border border-line bg-loam p-5">
              <div className="flex items-center justify-between">
                <span className="inscription text-sm text-bone-3">Grave Nº 000412 · $FUMBLE</span>
                <span className="text-[11px] font-bold tracking-[0.14em] text-ember">STIRRING · DAY 9 / 14</span>
              </div>
              <Pulse beats={syntheticBeats("stirring", 40, 11)} color="var(--ember)" glow scan className="mt-4 h-24 w-full" label="A stirring vital-signs trace" />
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {[
                  ["Liquidity", "$118k", true],
                  ["24h volume", "$412k", true],
                  ["Traders", "461", true],
                  ["Market cap", "5.8×", true],
                  ["Vol ÷ liq", "3.5×", true],
                  ["Sources", "2 agree", true],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-[10px] border border-line bg-loam-1 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-bone-4">{k}</div>
                    <div className="font-semibold text-bone">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SCENE 7 — UPSIDE */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
          <Reveal>
            <p className="eyebrow">V · Where the upside comes from</p>
            <h2 className="mt-4 max-w-3xl font-display text-4xl leading-tight text-bone sm:text-5xl">
              No yield. No new token. Only the buried coins themselves.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            <Reveal className="lg:col-span-2">
              <div className="h-full rounded-[18px] border border-line bg-loam-1 p-6">
                <div className="flex h-10 overflow-hidden rounded-full border border-line-strong">
                  <div className="flex w-[80%] items-center bg-ember/90 px-4 text-sm font-bold text-on-ember">80% back to the owner</div>
                  <div className="flex w-[18%] items-center justify-center bg-ember-deep/60 text-xs font-semibold text-bone">18% ossuary</div>
                  <div className="flex w-[2%] items-center justify-center bg-loam-4" title="2% upkeep" />
                </div>
                <p className="mt-5 text-bone-2">
                  When a plot rises, each of its graves is raised: 80% of the tokens go back to their owner, and the
                  20% tithe goes to the <span className="text-bone">ossuary</span>. The ossuary is split among every grave
                  resting in other plots, in proportion to what they buried, after a 2% upkeep fee. One rising pays the
                  whole cemetery.
                </p>
                <p className="mt-3 text-bone-2">
                  A single dead bag is a lottery ticket with terrible odds. A grave is a share of every resurrection that
                  happens while it rests.
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="h-full rounded-[18px] border border-line bg-loam-1 p-6">
                <h3 className="font-display text-2xl text-bone">What you give up</h3>
                <ul className="mt-4 space-y-3 text-sm text-bone-2">
                  <li>Buried tokens stay in the grave until their plot rises. There is no early exit.</li>
                  <li>If the coin never comes back, it stays buried. You hold the grave, not the coins.</li>
                  <li>If it does come back, 20% of yours pays the cemetery.</li>
                </ul>
                <Link href="/how#economics" className="mt-5 inline-block text-sm text-ember hover:underline">
                  Read the full economics →
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* WHY NEAR */}
      <section className="border-t border-line bg-loam-1/40">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
          <Reveal>
            <p className="eyebrow">VI · Why this only works on NEAR</p>
            <h2 className="mt-4 max-w-3xl font-display text-4xl leading-tight text-bone sm:text-5xl">
              One contract that can sign on Solana and Base, and see what happened there.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-px overflow-hidden rounded-[18px] border border-line bg-line md:grid-cols-2">
            {[
              ["Chain Signatures", "Every grave and the ossuary are addresses the Necropolis contract controls through NEAR's MPC network: EdDSA for Solana, ECDSA for Base. Payouts are transactions the contract builds itself and asks the MPC to sign."],
              ["Foreign-chain verification", "verify_foreign_transaction lets the contract ask the MPC network whether a Solana account or a Base Transfer log really exists. Burials are minted only when that attestation matches byte for byte."],
              ["Wallet-native ownership", "Graves are owned by your Solana or EVM key, expressed as a NEAR implicit account. You authorise actions by signing a message in Phantom or MetaMask; the contract checks it with ed25519_verify and ecrecover."],
              ["Functional NFTs", "Each grave is a NEP-171 token that controls a native-chain address and a claim on future payouts. Transfer the NFT and the claim goes with it. Its artwork changes as the plot stirs and rises."],
            ].map(([t, d]) => (
              <div key={t} className="bg-loam-1 p-7">
                <h3 className="font-display text-2xl text-bone">{t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-bone-2">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-24 text-center sm:px-6">
          <Reveal>
            <h2 className="mx-auto max-w-2xl font-display text-5xl leading-tight text-bone sm:text-6xl">Somewhere in your wallet, something has died.</h2>
            <p className="mx-auto mt-5 max-w-xl text-bone-2">{BRAND.tagline} Burials currently run on Solana devnet and Base Sepolia, with real NEAR testnet verification.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/scan" size="lg">Scan a wallet</ButtonLink>
              <ButtonLink href="/bury" variant="ghost" size="lg">Bury a test bag</ButtonLink>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
