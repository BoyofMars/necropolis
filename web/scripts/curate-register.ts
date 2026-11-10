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
import { dexSearch } from "../src/server/providers";

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
      const pairs = (await dexSearch(c.q)).filter(
        (p) => p.chainId === c.chain && p.baseToken.symbol.toUpperCase() === c.q.toUpperCase(),
      );
      if (pairs.length === 0) {
        console.log(`- ${c.q}: no exact match`);
        continue;
      }
      // the original token is usually the oldest pair with that ticker
      pairs.sort((a, b) => (a.pairCreatedAt ?? Infinity) - (b.pairCreatedAt ?? Infinity));
      const token = pairs[0].baseToken.address;
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
        checkedAt: Date.now(),
      });
    } catch (e) {
      console.log(`! ${c.q}: ${(e as Error).message}`);
    }
  }
  const keep = (out as { condition: string }[]).filter((x) => x.condition === "DEAD" || x.condition === "CRITICAL");
  writeFileSync(join(process.cwd(), "src/core/register-seed.json"), JSON.stringify(keep, null, 2));
  console.log(`\nkept ${keep.length} of ${out.length} (written to src/core/register-seed.json)`);
}

main();
