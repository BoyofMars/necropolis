# Evaluating Necropolis (for coding agents)

Necropolis is a NEAR contract plus a Next.js app. Everything below runs without keys; nothing here writes to any chain.

## Five-minute check

```bash
# 1. Contract: 58 unit tests, incl. three live MPC attestation vectors and the sale-mid-payout cases
cd contract && cargo test --lib

# 2. App engine: 36 unit tests (death model, rite, derivation, simulation, signed-message formats, NEP-413)
cd ../web && npm install --legacy-peer-deps && npm test

# 3. Live state: re-checks every claim the README makes about testnet, from public RPCs only
npm run verify          # expect "10/10 claims hold" and one note (the contract's access key)
```

Expected test names worth looking at:

- `a_sale_in_the_middle_of_a_payout_pays_the_buyer`, `a_claim_made_before_the_sale_stays_with_the_seller` (`contract/src/tests.rs`)
- `bones_rules_are_readable_and_every_mint_and_burn_is_logged`
- `matches_live_mpc_base_sepolia_vector`, `matches_live_mpc_solana_devnet_vector`, `matches_live_mpc_four_account_market_vector`

## Where the claims live

| Claim | Code | Live check |
|---|---|---|
| Burials are verified by NEAR MPC reading the origin chain | `contract/src/foreign.rs`, `contract/src/lib.rs` (`bury`, `on_verified`) | `npm run verify` → deposits |
| Vaults are MPC addresses only the contract can sign for | `web/src/core/derivation.ts` | `npm run verify` → vaults, ossuary |
| Each grave NFT controls a keyless NEAR account | `contract/src/accounts.rs` | `npm run verify` → accounts |
| $BONES: mint on burial, burn on rising, record-date split, no setters | `contract/src/bones.rs` | `npm run verify` → supply, rules; `get_bones_log` |
| Markets read by NEAR MPC, not reported | `contract/src/market.rs` | `npm run verify` → markets |
| Payouts built in-contract and signed by MPC | `contract/src/solana.rs`, `contract/src/evm.rs` | `npm run verify` → raises |
| Attacks the contract refuses | `web/scripts/e2e-accounts.ts` | `web/testnet-refused.json` (tx hashes, also on `/verify`) |

## Not verifiable offline

- End-to-end burials need the relayer's keys (`web/.env.local`, not in the repo). The README's proof tables link every transaction instead.
- The contract account still has one access key (stated in the README's Security model and reported by `npm run verify`).

## Live

- App: https://necropolis-wine.vercel.app (testnet). Judge desk: `/verify`.
- Contract: `necropolis.testnet`. MPC signer: `v1.signer-prod.testnet`.
