/**
 * Curate the "Register of the Dead": find real crashed memecoins on Solana and
 * Base, run the full autopsy on live data, and record the verdicts.
 * Only tokens the model actually pronounces CRITICAL/DEAD are kept.
 *
 *   npx tsx scripts/curate-register.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { diagnose } from "../src/core/death";
import { getDossier } from "../src/server/dossier";
import { getJson } from "../src/server/http";
import { dexSearch, type JupToken } from "../src/server/providers";

const CANDIDATES: { q: string; chain: "solana" | "base" }[] = [
  ...[
    "LIBRA", "MELANIA", "HAWK", "QUANT", "CAR", "JAILSTOOL", "DADDY", "MOTHER", "GME", "ZEREBRO",
    "GRIFFAIN", "LUCE", "FWOG", "MICHI", "SELFIE", "NUB", "RETARDIO", "HPOS", "ENRON", "SLERF",
    "SC", "BODEN", "TREMP", "WEN", "SMOLE", "SNAP", "BUTTHOLE", "VINE", "CHILLGUY", "AI16Z",
  ].map((q) => ({ q, chain: "solana" as const })),
  ...["NORMIE", "BALD", "MIGGLES", "KEYCAT", "DOGINME", "TYBG", "ROCKY", "BENJI", "MFER", "LUM", "HIGHER", "TOSHI"].map(
    (q) => ({ q, chain: "base" as const }),
  ),
];

async function main() {
  const out: unknown[] = [];
  for (const c of CANDIDATES) {
    try {
      // Identity matters more than coverage: a copycat with the same ticker must
      // never stand in for the original. Solana → Jupiter's ranked search,
      // preferring verified tokens; Base → pairs with a DexScreener profile.
      let token: string | undefined;
      let match = "";
      if (c.chain === "solana") {
        const res = await getJson<JupToken[]>("jupiter", `https://lite-api.jup.ag/tokens/v2/search?query=${c.q}`);
        const exact = res.filter((t) => t.symbol.toUpperCase() === c.q.toUpperCase());
        const pick =
          exact.find((t) => (t as JupToken & { isVerified?: boolean }).isVerified) ??
          exact.sort((a, b) => (b.holderCount ?? 0) - (a.holderCount ?? 0))[0];
        if (pick) {
          token = pick.id;
          match = (pick as JupToken & { isVerified?: boolean }).isVerified ? "jupiter-verified" : "jupiter-most-holders";
        }
        await new Promise((r) => setTimeout(r, 2_200));
      } else {
        const pairs = (await dexSearch(c.q)).filter(
          (p) => p.chainId === c.chain && p.baseToken.symbol.toUpperCase() === c.q.toUpperCase() && p.info,
        );
        pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        if (pairs[0]) {
          token = pairs[0].baseToken.address;
          match = "dexscreener-profile";
        }
      }
      if (!token) {
        console.log(`- ${c.q}: no confident match`);
        continue;
      }
      const chain = c.chain === "solana" ? "sol" : "base";
      const dossier = await getDossier(chain, token, { history: true, safety: false });
      const d = diagnose(dossier);
      console.log(
        `${d.condition.padEnd(8)} ${String(d.deathScore ?? "--").padStart(3)}  ${chain}:${dossier.profile.symbol}  ${d.headline}  [${d.cause.title}]  hist=${dossier.history.length}`,
      );
      out.push({
        chain,
        address: token,
        symbol: dossier.profile.symbol,
        name: dossier.profile.name,
        image: dossier.profile.imageUrl ?? null,
        condition: d.condition,
        deathScore: d.deathScore ?? null,
        cause: d.cause.code,
        causeTitle: d.cause.title,
        timeOfDeath: d.timeOfDeath ?? null,
        athPriceUsd: d.athPriceUsd ?? null,
        drawdown: d.drawdownFromAth ?? null,
        liquidityUsd: dossier.vitals.liquidityUsd?.value ?? null,
        match,
        checkedAt: Date.now(),
      });
    } catch (e) {
      console.log(`! ${c.q}: ${(e as Error).message}`);
    }
  }
  // Keep every verdict: the register shows the dead AND the famous crashes that are still breathing.
  const keep = (out as { condition: string }[]).filter((x) => x.condition !== "UNKNOWN");
  writeFileSync(join(process.cwd(), "src/core/register-seed.json"), JSON.stringify(keep, null, 2));
  const dead = keep.filter((x) => x.condition === "DEAD" || x.condition === "CRITICAL").length;
  console.log(`\n${dead} of ${keep.length} notable crashed tokens pronounced dead/critical (written to src/core/register-seed.json)`);
}

main();
