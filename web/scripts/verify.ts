/**
 * Re-check every live claim in the README from public RPCs.
 *
 *   npm run verify
 *
 * Reads NEAR testnet, Solana devnet and Base Sepolia directly. No keys, no
 * server of ours. Exits non-zero if any claim fails.
 */
import { runChecks, summarize } from "../src/core/verify";

const mark = { pass: "✓", fail: "✗", note: "·" } as const;

async function main() {
  const checks = await runChecks();
  for (const c of checks) {
    console.log(`${mark[c.status]} ${c.claim}`);
    console.log(`    ${c.detail}`);
    console.log(`    how: ${c.how}`);
  }
  const s = summarize(checks);
  console.log(`\n${s.passed}/${s.total} claims hold${s.notes ? ` (${s.notes} note${s.notes === 1 ? "" : "s"})` : ""}.`);
  process.exit(s.passed === s.total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
