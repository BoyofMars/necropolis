# Evaluating Necropolis (for coding agents)

Necropolis is a NEAR contract (`contract/`, Rust, near-sdk 5.30) and a Next.js 16 app (`web/`), live on NEAR testnet at https://necropolis-wine.vercel.app. This is the fast path for Claude Code, Codex and other reviewers. Everything here runs from a fresh clone **without keys** and **writes nothing to any chain**.

## Five-minute check

Requirements: Rust (stable, ≥ 1.95) and Node ≥ 20.9 (CI uses 22).

```bash
# 1. Contract: 58 unit tests, incl. three live MPC attestation vectors and the sale-mid-payout cases
cd contract && cargo test --lib

# 2. App: typecheck, lint, 36 unit tests (death model, rite, derivation, simulation, signed-message formats, NEP-413)
cd ../web && npm ci --legacy-peer-deps && npm run typecheck && npm run lint && npm test

# 3. Live state: re-checks every testnet claim in the README from public RPCs only
npm run verify          # expect "11/11 claims hold"

# 4. Optional: production build; the app runs read-only without keys
cp .env.example .env.local && npm run build
```

Last run from a fresh clone on 2026-11-13, all passing:

| Step | Result |
|---|---|
| `cargo test --lib` | `test result: ok. 58 passed` (first build ≈ 5 min) |
| `npm ci --legacy-peer-deps` | ok |
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` | `Tests 36 passed (36)`, 8 files |
| `npm run verify` | `11/11 claims hold.` |
| `npx playwright test --list` | 9 tests in 2 files (desktop + mobile smoke) |
| `npm run build` | ok |

CI runs steps 1–3 on every push: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Try the product (a browser, no wallet)

1. Open https://necropolis-wine.vercel.app → **Connect** → **Use a throwaway wallet** (a Solana devnet key kept in the browser; the relayer pays every fee).
2. `/bury` → **Claim test bags** (devnet can take a minute or two to list them) → pick a dead bag → **Review burial** → **Sign and bury**.
3. Watch Solana finality and NEAR MPC verification; the grave is minted on NEAR testnet in about 20 s. Its page shows its keyless account `g<id>.necropolis.testnet` and its $BONES.
4. `/crypt/<id>` opens only for the holder (signed message); `/verify` re-checks everything above live.

## Where the claims live

| Claim | Code | Live check |
|---|---|---|
| Burials are verified by NEAR MPC reading the origin chain | `contract/src/foreign.rs`, `contract/src/lib.rs` (`bury` and its MPC callback) | `npm run verify` → deposits |
| Vaults are MPC addresses only the contract can sign for | `web/src/core/derivation.ts` | `npm run verify` → vaults, ossuary |
| Each grave NFT controls a keyless NEAR account | `contract/src/accounts.rs` | `npm run verify` → accounts |
| $BONES: mint on burial, burn on rising, record-date split, no setters | `contract/src/bones.rs` | `npm run verify` → supply, rules; `get_bones_log` |
| Markets read by NEAR MPC, not reported | `contract/src/market.rs` | `npm run verify` → markets |
| Payouts built in-contract and signed by MPC | `contract/src/solana.rs`, `contract/src/evm.rs` | `npm run verify` → raises |
| Owners act by wallet signature (ed25519 / EIP-191), with nonces | `contract/src/auth.rs` | refused replays in `web/testnet-refused.json` |
| Attacks the contract refuses | `web/scripts/e2e-accounts.ts` | `web/testnet-refused.json` (tx hashes, re-read on an archival node by `/verify`) |
| Holder-only crypt, NEP-413 for NEAR accounts | `web/src/app/api/crypt/route.ts`, `web/src/server/nep413.ts` | `web/src/core/__tests__/nep413.test.ts` |
| Nobody can change the contract: no access keys, and its owner is itself | `web/scripts/lock-contract.ts` | `npm run verify` → lock; DeleteKey tx `BGqCS9F98vw8BzBfBxdy2asoB4Bpt6TSzmiBF9QdBkUB` |

Test names worth reading (`contract/src/tests.rs`): `a_sale_in_the_middle_of_a_payout_pays_the_buyer`, `a_claim_made_before_the_sale_stays_with_the_seller`, `bones_rules_are_readable_and_every_mint_and_burn_is_logged`, `matches_live_mpc_base_sepolia_vector`, `matches_live_mpc_solana_devnet_vector`, `matches_live_mpc_four_account_market_vector`.

## What can't be checked from a clone, and what's simulated

- **Burials from a clone** need the relayer's keys (`web/.env.local`, not in the repo). The live app runs one for anyone (above), and the README's [live runs](README.md#proof-it-works-live-runs-on-testnet) link every transaction.
- **Testnet market data** is mostly simulated (devnet tokens have no markets), and the rite's timers are compressed to minutes. $NGMI's market is a real Raydium devnet pool read by NEAR MPC. Full list: the README's [What is real and what is simulated](README.md#what-is-real-and-what-is-simulated-testnet) and [Honest limits](README.md#honest-limits).

## Live

- App: https://necropolis-wine.vercel.app (testnet). Judge desk: `/verify`.
- Contract: `necropolis.testnet` (locked, 0 access keys). MPC signer: `v1.signer-prod.testnet`.
