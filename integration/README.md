# Sandbox tests

The compiled Necropolis contract, run in a local NEAR node through
[near-workspaces](https://github.com/near/near-workspaces-rs). Real accounts,
real gas, real cross-contract promises and callbacks. The only stand-in is NEAR's
MPC network, played by [`mock-mpc`](mock-mpc/src/lib.rs).

The unit tests in `contract/src/tests.rs` cover the logic. They call internal
functions directly, so they skip the promise chain that a burial goes through.
These tests cover that chain:

```
coroner → bury ─► mpc.derived_public_key ─► on_grave_address
                     ─► mpc.verify_foreign_transaction ─► on_deposit_verified ─► grave minted
```

They also cover the keyless grave sub-accounts that burial creates, the rite
across separate transactions, and payouts signed through the MPC `sign` call.

| Test | What it proves |
|---|---|
| `the_full_ritual_bury_rise_raise_and_claim` | Two burials go through the full MPC promise chain. Each grave gets a sub-account `g<id>.<contract>` with **no access keys** that holds its $BONES. Plot X stirs on three readings and rises on the fourth, and X's BONES burn. A claim made before the raise is refused. The raise is signed by MPC and pays 80% to the depositor's own Solana key and 20% to the ossuary. Grave Y's holder takes the whole pool, and only once. |
| `a_deposit_the_chain_does_not_hold_mints_nothing` | A transaction the chain never saw mints nothing. A deposit that claims more than the grave's account holds mints nothing, because the MPC network refuses the mismatched payload hash. Neither attempt leaves anything behind, so the same grave can be dug once the deposit is real. |
| `a_sale_in_the_middle_of_a_payout_pays_the_buyer` | The seller is an implicit account whose Solana key is also its NEAR key. It sells grave 1 with a standard NEP-171 `nft_transfer` after a rising but before the claim. The buyer sets a payout wallet and gets paid. The seller can no longer exhume BONES or redirect the payout. The grave's on-chain history reads `buried → bones_minted → transferred → earned → bones_exhumed`. |

## What the mock does, and doesn't do

`mock-mpc` answers the three calls Necropolis makes to `v1.signer-prod.testnet`,
using the same argument and response shapes:

- **`derived_public_key`** returns a deterministic key for each (caller, path,
  domain), so the tests can work out every grave address in advance.
- **`verify_foreign_transaction`** acts like an honest network. It answers only
  for transactions the test registered as "seen on the origin chain", each with
  the payload hash of what that chain really holds. Like the real signer, it
  refuses when the contract's `expected_payload_hash` doesn't match.
- **`sign`** returns a deterministic response. Necropolis stores it as is.

The real network uses threshold MPC; the mock is a single honest party. What these
tests prove is the contract's side: it mints, rises and pays only on the answers
an honest network would give. The live MPC network itself is covered by three
attestation vectors captured from `v1.signer-prod.testnet`, in
`contract/src/tests.rs` (`matches_live_mpc_*`), and by the live runs listed in
the main README.

The tests compute the MPC payload hash themselves, following the borsh layout in
`contract/src/foreign.rs`. If the two disagreed, every honest burial would fail.

## Run

The NEAR sandbox runs on Linux and macOS. CI runs these tests on every push
(`sandbox` job in `.github/workflows/ci.yml`).

```bash
# once: the wasm build tool
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/download/cargo-near-v0.23.0/cargo-near-installer.sh | sh

(cd contract && cargo near build non-reproducible-wasm --no-abi)
(cd integration/mock-mpc && cargo near build non-reproducible-wasm --no-abi)
cd integration && cargo test
```

`NECROPOLIS_WASM` and `MOCK_MPC_WASM` override the wasm paths. The defaults are
`../contract/target/near/necropolis.wasm` and `mock-mpc/target/near/mock_mpc.wasm`.
