import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/brand";
import { THRESHOLDS, WEIGHTS } from "@/core/death";
import { MAINNET_TERMS, TESTNET_TERMS } from "@/core/resurrection";
import { WEIGHT_CAP_MAX_USD, WEIGHT_CAP_MIN_USD, MIN_DEATH_SCORE_FOR_WEIGHT } from "@/core/appraisal";
import { Simulator } from "./Simulator";

export const metadata: Metadata = {
  title: "How it works",
  description: "Burial, verification, the death methodology, the resurrection rule, economics and the trust model, in full.",
};

const fmt = (n: number) => (n >= 1000 ? `$${(n / 1000).toLocaleString()}k` : `$${n}`);

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line py-14">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 font-display text-4xl text-bone">{title}</h2>
      <div className="mt-6 space-y-4 leading-relaxed text-bone-2">{children}</div>
    </section>
  );
}

export default function How() {
  const comps = [
    ["Liquidity", WEIGHTS.liquidity, "$50k → alive · $1k → dead, log scale", "Solidus Labs: 98.6% of Solana memecoins ended under $1k of liquidity"],
    ["Volume vs. peak", WEIGHTS.volumeDecay, "30-day average ÷ peak 7-day average: 10% → alive · 1% → dead", "Feder et al. / Gandal et al.: dead ≤ 1% of past peak"],
    ["Daily volume (7d)", WEIGHTS.volume7d, "$10k/day → alive · $10/day → dead, log", "Chainplay / Coinopsy anchors"],
    ["Activity", WEIGHTS.activity, "unique traders 200 → 5 (or trades 400 → 8)", "judgement call; raw counts are easy to fake, so weight is moderate"],
    ["Dormancy", WEIGHTS.dormancy, `days since a day with ≥ $${THRESHOLDS.meaningfulDailyVolume} traded: 0 → 30`, "Chainalysis: a pool is inactive after 30 days without transactions"],
    ["Drawdown", WEIGHTS.drawdown, "-80% → alive · -99% → dead", "deliberately low weight: TRUMP and FARTCOIN sat at -90% while very alive"],
  ] as const;

  return (
    <div className="mx-auto max-w-[900px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
      <p className="eyebrow">How it works</p>
      <h1 className="mt-3 font-display text-5xl leading-tight text-bone sm:text-6xl">The whole mechanism, in plain words.</h1>
      <p className="mt-4 text-lg text-bone-2">
        {BRAND.name} turns a dead memecoin into a position. You bury it on its own chain, NEAR verifies the burial, and if the coin
        objectively comes back you get most of it back, while every other grave shares the rest.
      </p>
      <nav className="mt-8 flex flex-wrap gap-2 text-sm" aria-label="On this page">
        {[
          ["burial", "Burial"],
          ["methodology", "Death methodology"],
          ["resurrection", "Resurrection"],
          ["economics", "Economics"],
          ["simulation", "60-day simulation"],
          ["security", "Trust & security"],
          ["limits", "Sybil limits & failure cases"],
        ].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-line px-3 py-1.5 text-bone-3 hover:border-bone-4 hover:text-bone">
            {l}
          </a>
        ))}
      </nav>

      <Section id="burial" eyebrow="1 · Burial" title="Your token never leaves its chain.">
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <span className="text-bone">A grave address is derived.</span> For every burial the contract has a fresh path,{" "}
            <code className="font-mono text-sm">bag/v1/&lt;chain&gt;/&lt;token&gt;/&lt;your address&gt;/&lt;nonce&gt;</code>. NEAR Chain Signatures turn
            (contract account, path) into a Solana or Base address. No private key exists for it; only the Necropolis contract can ask
            the MPC network to sign for it. Before you send anything, the server derives it twice, offline and from the MPC network, and
            refuses if they differ.
          </li>
          <li>
            <span className="text-bone">You send the token there.</span> One ordinary transfer from the wallet you already use. On
            Solana we pay the network fee and the grave account rent, and burying your whole balance closes your empty token account and
            refunds its rent to you.
          </li>
          <li>
            <span className="text-bone">NEAR verifies it.</span> After finality (Solana &ldquo;finalized&rdquo;, Base &ldquo;safe&rdquo;), the
            contract calls <code className="font-mono text-sm">verify_foreign_transaction</code> on NEAR&rsquo;s MPC signer. The MPC nodes
            read the grave&rsquo;s token account (Solana) or the ERC-20 Transfer log (Base) themselves. The contract passes the hash of
            what it <em>expects</em> to see; the MPC contract rejects any mismatch.
          </li>
          <li>
            <span className="text-bone">A grave is minted.</span> A NEP-171 token owned by your own key, as a NEAR implicit account
            (the hex of your Solana key, or your 0x address). You never need a NEAR wallet: actions are authorised by signing a message
            in Phantom or MetaMask, verified on-chain with <code className="font-mono text-sm">ed25519_verify</code> /{" "}
            <code className="font-mono text-sm">ecrecover</code>.
          </li>
        </ol>
      </Section>

      <Section id="methodology" eyebrow="2 · Death methodology" title="Death is measured, not declared.">
        <p>
          Six signals, each scored from 0 (alive) to 1 (dead) against fixed anchors and combined with fixed weights into a death
          score out of 100. Model <span className="font-mono text-sm">dm-1.0</span>.
        </p>
        <div className="overflow-x-auto rounded-[14px] border border-line">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-loam-1 text-bone-4">
              <tr>
                <th className="px-4 py-2.5 font-medium">Signal</th>
                <th className="px-4 py-2.5 font-medium">Weight</th>
                <th className="px-4 py-2.5 font-medium">Anchors</th>
                <th className="px-4 py-2.5 font-medium">Basis</th>
              </tr>
            </thead>
            <tbody>
              {comps.map(([s, w, a, b]) => (
                <tr key={s} className="ledger-row">
                  <td className="px-4 py-2.5 text-bone">{s}</td>
                  <td className="px-4 py-2.5 tabular">{Math.round(w * 100)}%</td>
                  <td className="px-4 py-2.5 text-bone-2">{a}</td>
                  <td className="px-4 py-2.5 text-xs text-bone-3">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-2 pl-5">
          <li><span className="text-bone">Classes:</span> Alive &lt; {THRESHOLDS.fading} · Fading {THRESHOLDS.fading}–{THRESHOLDS.critical - 1} · Critical {THRESHOLDS.critical}–{THRESHOLDS.dead - 1} · Dead ≥ {THRESHOLDS.dead}.</li>
          <li><span className="text-bone">Activity floor:</span> {THRESHOLDS.activityFloorTraders24h}+ traders a day, or ${THRESHOLDS.activityFloorDailyVolume.toLocaleString()}+ a day of volume, caps a token at Fading, however far it fell.</li>
          <li><span className="text-bone">Fast path:</span> under ${THRESHOLDS.fastPathLiquidity.toLocaleString()} of liquidity and no meaningful trade for {THRESHOLDS.fastPathDormantDays} days is death even with thin history.</li>
          <li><span className="text-bone">Refusals:</span> if under {Math.round(THRESHOLDS.minEvidence * 100)}% of the weight can be measured, or there are fewer than {THRESHOLDS.minHistoryDays} days of history, we say &ldquo;not enough evidence&rdquo; instead of guessing.</li>
          <li><span className="text-bone">Honest history:</span> keyless price history covers about six months. When a token was already flat on day one, we report &ldquo;dead for N+ days&rdquo; and leave the cause undetermined instead of inventing a date.</li>
          <li><span className="text-bone">Provenance:</span> every number shows its source (DexScreener, Jupiter, GeckoTerminal, RugCheck, honeypot.is) and fetch time.</li>
        </ul>
      </Section>

      <Section id="resurrection" eyebrow="3 · Resurrection" title="A pump is not a pulse.">
        <p>
          Coroners report raw vital signs on-chain. The contract checks every observation against terms frozen into the plot when its first
          grave was dug. All conditions must hold at every observation:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Liquidity ≥ {fmt(MAINNET_TERMS.minLiquidityUsd)}</li>
          <li>24h volume ≥ max({fmt(MAINNET_TERMS.minVolume24hUsd)}, {MAINNET_TERMS.minPeakVolumeShareBps / 100}% of the pre-death peak daily volume)</li>
          <li>≥ {MAINNET_TERMS.minTraders24h} unique traders in 24h</li>
          <li>Market cap ≥ max({fmt(MAINNET_TERMS.minMcapUsd)}, {MAINNET_TERMS.minMcapMultipleX100 / 100}× the market cap at burial)</li>
          <li>Volume ÷ liquidity ≤ {MAINNET_TERMS.maxVolumeToLiquidityX100 / 100}× (above that, volume is presumed wash trading)</li>
          <li>Flagged (non-organic) volume ≤ {MAINNET_TERMS.maxFlaggedShareBps / 100}%</li>
          <li>≥ {MAINNET_TERMS.minSources} independent data sources agree</li>
        </ul>
        <p>
          The first passing observation makes the plot <span className="text-ember">stirring</span>. It <span className="text-ember">rises</span>{" "}
          only after {MAINNET_TERMS.windowSecs / 86_400} consecutive days with at least {MAINNET_TERMS.minObservations} passing observations and no gap over{" "}
          {MAINNET_TERMS.maxGapSecs / 3600} hours. A single failing observation is a <span className="text-bone">false dawn</span>: back to resting, counter
          incremented. On testnet the thresholds are identical but timers are compressed ({TESTNET_TERMS.windowSecs / 60}-minute window,{" "}
          {TESTNET_TERMS.minObservations} observations) so the rite can be demonstrated.
        </p>
        <p className="text-sm text-bone-3">
          Why 14 days: TROLL&rsquo;s April 2025 &ldquo;revival&rdquo; reversed 99% within weeks, and wash-trading campaigns on dormant Solana tokens recur
          roughly every 16 days (arXiv 2507.01963).
        </p>
      </Section>

      <Section id="economics" eyebrow="4 · Economics" title="Where the upside actually comes from.">
        <p>
          There is no yield. The only value in the system is the buried tokens themselves, and they only matter if the coin recovers.
          Your share of them is a token, <span className="text-ember">$BONES</span>.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li><span className="text-bone">When a plot rises</span>, each of its graves is raised: 80% of its tokens go back to the owner, 20% (the tithe) to that chain&rsquo;s ossuary address.</li>
          <li><span className="text-bone">$BONES</span> (NEP-141, on the registry contract) is minted when you bury: one per dollar of ossuary weight, into your grave&rsquo;s own NEAR account, so it travels with the grave NFT. It&rsquo;s burned when your own coin rises, so supply grows as coins die and shrinks as they come back. Every mint and burn is logged on chain: <a className="text-ember hover:underline" href="/bones">see the log</a>.</li>
          <li><span className="text-bone">The ossuary</span> of each rising is split among $BONES holders by their balance at that moment, read from on-chain checkpoints. Buying $BONES after a rising gets nothing from it. 10% of the tithe (2% of the plot) is upkeep for the protocol.</li>
          <li><span className="text-bone">$BONES is transferable:</span> sell your claim on future resurrections without waiting for one. Solana and EVM holders move it by signing a message; NEAR accounts use <code className="font-mono text-xs">ft_transfer</code>.</li>
          <li><span className="text-bone">Weight</span> is a grave&rsquo;s salvage value at burial: amount × 7-day average price, with each plot&rsquo;s total capped at its real liquidity ({fmt(WEIGHT_CAP_MIN_USD)}–{fmt(WEIGHT_CAP_MAX_USD)}). Tokens with a death score under {MIN_DEATH_SCORE_FOR_WEIGHT} get unmarked graves: they can rise, but carry no weight.</li>
          <li><span className="text-bone">Who pays whom:</span> the owners of a risen plot pay 20% of their recovered tokens to everyone else. A single dead bag is a near-worthless lottery ticket; a grave is a share in every resurrection that happens while it rests.</li>
          <li><span className="text-bone">What you give up:</span> there is no early exit, and if the coin never recovers the tokens stay buried.</li>
        </ul>
      </Section>

      <Section id="simulation" eyebrow="5 · Simulation" title="60 days, four futures.">
        <p>A seeded simulation of the cemetery under different revival rates and attacks, using the same payout rules as the contract.</p>
        <Simulator />
      </Section>

      <Section id="security" eyebrow="6 · Trust & security" title="Who can do what.">
        <div className="overflow-x-auto rounded-[14px] border border-line">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-loam-1 text-bone-4">
              <tr>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Can</th>
                <th className="px-4 py-2.5 font-medium">Cannot</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["NEAR MPC network", "Sign for grave/ossuary addresses when the contract asks; attest foreign transactions", "Sign anything the contract did not build (threshold MPC, 11 of 16 nodes)"],
                ["Necropolis contract", "Build payout transactions: raise (owner + ossuary only), ossuary claims (pro rata only)", "Send buried tokens anywhere else; mint a grave without a matching MPC attestation"],
                ["Coroner (Sexton)", "Appraise burials (value, weight); report vital signs", "Move tokens; fabricate a deposit; decide resurrection (the contract does)"],
                ["Relayer (Sexton)", "Pay fees; broadcast signed transactions anyone could broadcast", "Redirect a payout: destination accounts are derived on-chain"],
                ["Owner (you)", "Transfer the grave, set an epitaph or payout address with a wallet signature", "Withdraw before the plot rises"],
                ["Contract owner key", "Add/remove coroners; set NFT base URI", "Change a plot's frozen terms or touch buried tokens"],
              ].map(([a, c, n]) => (
                <tr key={a} className="ledger-row align-top">
                  <td className="px-4 py-3 text-bone">{a}</td>
                  <td className="px-4 py-3 text-bone-2">{c}</td>
                  <td className="px-4 py-3 text-bone-3">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The coroner is the main trust assumption. A dishonest coroner can make a plot rise early, which pays owners back early and
          sends tithe to the ossuary, or never let it rise; it can mis-appraise weights. It cannot steal buried tokens. Hardening path:
          multiple independent coroners with on-chain quorum, and observations signed by the MPC network&rsquo;s foreign-chain reads where possible.
        </p>
      </Section>

      <Section id="limits" eyebrow="7 · Limits" title="Sybil limits and failure cases.">
        <ul className="list-disc space-y-2 pl-5">
          <li><span className="text-bone">Fake dead tokens to farm the ossuary:</span> weight is capped by the plot&rsquo;s real liquidity and needs a death score ≥ {MIN_DEATH_SCORE_FOR_WEIGHT}. Farming weight requires locking real liquidity in a token that then has to stay dead. Residual risk: liquidity-time is cheap for a patient attacker; documented, not solved.</li>
          <li><span className="text-bone">Faking a resurrection</span> is unprofitable for the plot&rsquo;s own buriers: they pay 20% to everyone else and only get their own tokens back sooner.</li>
          <li><span className="text-bone">Duplicate burials:</span> each origin transaction and each grave path can become exactly one grave.</li>
          <li><span className="text-bone">MPC verification fails or times out:</span> the pending burial is released and registration can be retried; tokens are already safe in the grave address.</li>
          <li><span className="text-bone">Burial into a plot that started stirring:</span> the deposit is still registered (never stranded) but earns no weight.</li>
          <li><span className="text-bone">Solana payout expires before broadcast:</span> raising can be re-signed; a second execution fails because the grave account is empty.</li>
          <li><span className="text-bone">Base payout gas:</span> the relayer tops up the grave address; EVM payouts use fixed nonces so re-broadcasting is safe.</li>
          <li><span className="text-bone">Ossuary claim on Solana that never lands:</span> the claim is released when signing fails; a landed-then-lost claim needs coroner attestation to re-sign (documented limitation).</li>
          <li><span className="text-bone">Ineligible tokens</span> (freeze authority, permanent delegate, transfer hooks or fees, honeypots, transfer taxes) are refused before any transfer.</li>
        </ul>
      </Section>

      <p className="border-t border-line pt-8 text-sm text-bone-4">
        {BRAND.disambiguation} Source and contract: <a className="text-ember hover:underline" href={BRAND.repo}>{BRAND.repo.replace("https://", "")}</a>.{" "}
        <Link href="/proof" className="text-ember hover:underline">Verify everything →</Link>
      </p>
    </div>
  );
}
