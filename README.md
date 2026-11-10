# Necropolis

**A graveyard for dead memecoins on Solana and Base.** You bury a dead token on its own chain, NEAR's MPC network verifies the burial, and if the coin ever *objectively* comes back you get 80% of it back. The other 20% is shared by every grave still resting in the cemetery.

> Dead tokens shouldn't just disappear from a wallet. They can become positions in a market about resurrection.

*Not affiliated with necropolis.fund, an unrelated Robinhood Chain project that funds bonding-curve graduations. This Necropolis buries Solana and Base tokens and verifies them on NEAR.*

| | |
|---|---|
| **Contract** | [`necropolis.testnet`](https://testnet.nearblocks.io/address/necropolis.testnet) (NEAR testnet) |
| **MPC signer** | [`v1.signer-prod.testnet`](https://testnet.nearblocks.io/address/v1.signer-prod.testnet) (Chain Signatures + foreign-chain verification) |
| **Origin chains** | Solana devnet, Base Sepolia (mainnet chains are coded but closed) |
| **Live demo** | **https://necropolis-wine.vercel.app** (testnet) |
| **Tracks** | Memecoins With Mechanics · Open Innovation · NFTs That Do Something |

---

## The problem

Memecoins die at industrial scale. CoinGecko counts **11.6 million** tokens that stopped trading in 2025. Only about 4.5% of pump.fun tokens trade past day 90, and 98.6% of Solana memecoins end with under $1,000 of liquidity (Solidus Labs). The positions don't disappear: they sit in wallets as clutter, get hidden by spam filters, or get burned for a few cents of rent. Every existing tool treats a dead token as waste. None keeps the holder's claim on a possible recovery, and none pools those claims.

## The idea

1. **Bury.** Send a dead token to its own *grave address* on its native chain. The address is derived from the Necropolis contract through NEAR Chain Signatures, so nobody holds its key. Only the contract can ever ask NEAR's MPC network to sign for it.
2. **Verify.** NEAR's MPC network reads the deposit directly from Solana or Base (`verify_foreign_transaction`). The contract mints a **grave**, an NEP-171 token owned by your own wallet key, only if that attestation matches the claimed deposit byte for byte.
3. **The rite.** Coroners report vital signs. The contract decides, using terms frozen when the token's plot opened, whether the token is stirring, has had a false dawn, or has risen. A pump is not a pulse: the recovery must hold for 14 consecutive days on liquidity, volume, traders, market cap, wash-trading limits and source agreement.
4. **Raise.** When a plot rises, the contract builds the payout transactions itself and the MPC network signs them. 80% goes back to each grave's owner, and 20% (the tithe) goes to the ossuary. The ossuary is shared pro rata by every grave resting in *other* plots.

There is no yield and no new token. The only value in the system is the buried coins, and they only matter if they recover.

## Why NEAR (and why it couldn't be built elsewhere the same way)

| NEAR primitive | What Necropolis uses it for |
|---|---|
| **Chain Signatures** (EdDSA domain 1, ECDSA domain 0) | Every grave and ossuary is an address on Solana or Base that the contract controls. Payouts are transactions **the contract builds itself**: Solana legacy messages with on-chain ATA derivation, and EIP-1559 ERC-20 transfers with in-contract RLP. The MPC network signs them. Relayers cannot redirect a payout. |
| **Foreign-chain transaction verification** (`verify_foreign_transaction`, MPC v3.18) | Burials are verified **trustlessly** by the MPC network. On Base it reads the ERC-20 `Transfer` log; on Solana it reads the grave's token-account state. The contract supplies the expected payload hash and the MPC contract rejects any mismatch. The same primitive makes **NEAR MPC the coroner for markets**: one request reads a Raydium pool, its vaults and the token's mint, and the contract computes liquidity, price and market cap for the rite itself (`contract/src/market.rs`). Our borsh encoder is tested against three live testnet attestations (`contract/src/foreign.rs`). |
| **Implicit accounts + host crypto** | Graves are owned by your own key, expressed as a NEAR implicit account: a Solana key is a 64-hex account, an EVM address is a NEP-518 eth-implicit account. Owners act by signing a message in Phantom or MetaMask, verified on-chain with `ed25519_verify` / `ecrecover`. **Users never need a NEAR wallet or NEAR tokens.** |
| **NEP-171/177 NFTs** | A grave is a functional NFT: it is the claim on a native-chain address, on the owner share and on ossuary shares. Its image is live and evolves with plot state (fresh → mossy → stirring → risen). |
| **NEP-297 events** | Every burial, observation, rising and payout is a public log line. |

**No bridge, anywhere.** Tokens never leave their chain and nothing is wrapped. NEAR is the coordination and verification layer, and it is essential: without Chain Signatures nobody could hold the vaults without trusting a custodian, and without foreign-chain verification the burials couldn't be proven.

## Architecture

```mermaid
flowchart LR
  subgraph User["User wallet (Phantom / MetaMask)"]
    W[Sign one native transfer]
  end
  subgraph Origin["Solana / Base"]
    G[(Grave address\n= derive(necropolis.testnet, path))]
    O[(Ossuary address)]
  end
  subgraph NEAR
    C[Necropolis contract\ngraves · plots · rite · payouts]
    M[MPC signer v1.signer-prod.testnet\nsign + verify_foreign_transaction]
  end
  S[Sexton\nrelayer + coroner]
  W -- transfer --> G
  S -- bury(deposit proof, appraisal) --> C
  C -- derived_public_key --> M
  C -- verify_foreign_transaction(expected hash) --> M
  M -. reads chain .-> G
  S -- observe(vitals) --> C
  C -- sign(payout built by contract) --> M
  S -- broadcast signed payout --> G
  G -- 80% --> W
  G -- 20% tithe --> O
```

**Burial lifecycle.** `prepare` derives the grave address twice, offline and from the MPC network, and refuses on mismatch. Then you sign one native transfer. On Solana, the Sexton pays the fee and the grave account rent, and burying your whole balance closes your emptied account and refunds its rent. After finality (Solana `finalized`, Base `safe`), the server calls `bury`. The contract then runs a promise chain: `derived_public_key`, then checks the claimed deposit against that address, then `verify_foreign_transaction`, then mints the grave. Every step is idempotent: each grave path and each deposit can become exactly one grave.

## Death classification (model `dm-1.0`)

Six signals, each scored 0 (alive) to 1 (dead) against fixed anchors, combined into a 0–100 death score. Code: `web/src/core/death.ts`.

| Signal | Weight | Anchors | Basis |
|---|---|---|---|
| Liquidity | 25% | $50k → alive, $1k → dead (log) | Solidus Labs: <$1k is "essentially worthless" |
| Volume vs. peak | 20% | 30d avg ÷ peak 7d avg: 10% → 1% | Feder et al. / Gandal et al. definition of a dead coin |
| Daily volume (7d) | 15% | $10k → $10 per day (log) | Chainplay / Coinopsy anchors |
| Activity | 15% | 200 → 5 unique traders (or 400 → 8 trades) | judgement call |
| Dormancy | 15% | days since a ≥$50 day: 0 → 30 | Chainalysis: inactive after 30 days |
| Drawdown | 10% | -80% → -99% | low weight: TRUMP and FARTCOIN sat at -90% alive |

Classes: Alive < 35 · Fading 35–59 · Critical 60–79 · Dead ≥ 80. Overrides:

- **Activity floor:** 50+ traders or $1k+ a day caps a token at Fading.
- **Fast path:** under $1k liquidity plus 30 days without a meaningful trade is Dead.
- **Refusal:** "not enough evidence" when under 55% of the weight is measurable.
- **Honest truncated history:** keyless GeckoTerminal serves about six months. If a token was flat from day one of that window, we report "dead for N+ days" and leave the cause undetermined instead of inventing a date.

**Evidence that it's calibrated:** of 36 famous crashed memecoins we examined with live data, the model pronounces only **4** dead or critical ($LIBRA, $HAWK, $NORMIE, $BALD). The rest still have real traders, and the Discover page says so. Tokens are matched via Jupiter's verified list or DexScreener profiles; our first pass caught copycat "MELANIA" and "MICHI" tokens impersonating the originals.

## Resurrection rule (the rite)

All conditions must hold at **every** observation. Terms are frozen into a plot when its first grave is dug. Code: `contract/src/rite.rs`, mirrored in `web/src/core/resurrection.ts`.

- Liquidity ≥ $50k
- 24h volume ≥ max($25k, 10% of the pre-death peak daily volume)
- ≥ 100 unique traders in 24h
- Market cap ≥ max($250k, 5× market cap at burial)
- Volume ÷ liquidity ≤ 20× (above that it's presumed wash trading)
- Flagged (non-organic) volume ≤ 30%
- ≥ 2 independent data sources agree

The first passing observation makes the plot **stirring**. It **rises** after 14 consecutive days with ≥14 passing observations and no gap over 36 h. A failing observation is a **false dawn**: the plot goes back to resting and the counter increments. On **testnet** the thresholds are identical but the timers are compressed (6-minute window, 3 observations) so the rite can be demonstrated end to end.

## Economics

- **Raise:** 80% of a risen grave's tokens go to its owner. 20% (the tithe) goes to the ossuary address on that chain.
- **Ossuary:** each rising creates an event that snapshots the total weight of graves resting in other plots. Each such grave can claim `pool × weight / total weight`. 10% of the tithe (2% of the plot) is upkeep.
- **Weight** is salvage value at burial: amount × 7-day average price. Each plot's total weight is capped at its real liquidity ($50–$25k). A grave with a death score under 60 is unmarked: it can rise, but carries no weight.
- **Who pays whom:** owners of a risen plot pay 20% of their recovered tokens to everyone else in the cemetery. A single dead bag is a near-worthless lottery ticket; a grave is a share in every resurrection while it rests.
- **What you give up:** there is no early exit, and if the coin never recovers it stays buried.
- **60-day simulation:** `web/src/core/simulation.ts` models four futures (graveyard, rare revivals, memecoin summer, wash-trading attack) with the contract's exact payout split. It's interactive on `/how#simulation`.

## Security model

| Actor | Can | Cannot |
|---|---|---|
| NEAR MPC network | Sign for grave/ossuary addresses when the contract asks; attest foreign transactions | Sign anything the contract didn't build (threshold MPC) |
| Necropolis contract | Build payouts: raise (owner + ossuary only), ossuary claims (pro rata) | Send buried tokens anywhere else; mint a grave without a matching MPC attestation |
| Coroner (Sexton) | Appraise burials (value, weight); report vital signs. On plots bound to a pool, only volume and trader counts | Move tokens; fabricate deposits; decide resurrection (the contract does); report liquidity, price or market cap for a pool-bound plot (NEAR MPC reads them) |
| Relayer (Sexton) | Pay fees; broadcast transactions anyone could broadcast; relay owner-signed actions (it checks the signature first, so forgeries cost it nothing) | Redirect payouts: destination accounts are derived on-chain. Forge, alter or replay an owner action: the contract verifies the signature and nonce itself |
| Grave owner | Transfer the grave; set epitaph or payout address via wallet signature (nonce-protected) | Withdraw before the plot rises |
| Contract owner key | Add/remove coroners; set NFT base URI | Change a plot's frozen terms; touch buried tokens |

**Main trust assumption: the coroner, and how much of it NEAR MPC removes.** A dishonest coroner can stall a rising or mis-appraise weights. It can't steal buried tokens or mint graves without real deposits.

The rite's hardest numbers (liquidity, price, market cap) are no longer the coroner's word. A Solana plot can be bound to its Raydium CPMM pool. After that, each reading is a single `verify_foreign_transaction` in which **NEAR's MPC network reads four accounts**: the pool state, both vaults and the token's mint. The contract computes the numbers itself:

- liquidity is 2× the stablecoin reserve, net of accrued fees;
- price is the reserve ratio;
- market cap is price × the mint's supply.

The coroner only supplies copies, and if the MPC network reads anything different, nothing is applied. The vault and mint keys come out of data the AMM program wrote, so they can't be swapped. MPC reads are live (`getAccountInfo` at a slot no earlier than the anchor transaction), so an old state can't be replayed. A bound plot refuses unverified readings and any other pool.

What's left on the coroner's word is volume and trader counts, which aren't account state. The hardening path for those is multiple independent coroners with an on-chain quorum.

### Sybil limits & failure cases

- **Farming ossuary weight with fake dead tokens.** Weight is capped by the plot's real liquidity and requires a death score of 60 or more, so an attacker must lock real liquidity in a token that then stays dead. Residual risk: liquidity-time is cheap for a patient attacker.
- **Faking a resurrection** is unprofitable for the plot's own buriers. They pay 20% to everyone else and just get their own tokens back sooner.
- **Ineligible tokens are refused before any transfer:** freeze authority, permanent delegate, transfer hooks or fees, honeypots, transfer taxes.
- **MPC verification failure or timeout:** the pending burial is released and registration can be retried. The tokens are already safe in the grave address.
- **A deposit into a plot that started stirring** is still registered, so it is never stranded, but earns no weight.
- **Expired Solana payouts** can be re-signed. A second execution fails because the grave account is empty. EVM payouts use fixed nonces, so re-broadcasting is safe.
- **A Solana ossuary claim that is lost after landing** needs a coroner attestation before it can be re-signed. The contract can't tell an expired transaction from one that already landed, so it never re-signs on its own: that could pay a share twice from other graves' money. This is a documented limitation.
- **Pumping a pool for one reading** doesn't work. Liquidity is real stablecoin in the vault, and the rite needs readings across the whole window (14 days on mainnet), so an attacker would have to keep real money in the pool the entire time.
- **Candles are sybil-able by design.** It's one per wallet per grave, but wallets are free, so a candle count is a social signal. It never touches money or weight.
- **Busy pools.** The coroner's copy and the MPC network's read must match byte for byte, so a pool that trades in between fails that reading and the coroner retries. That's fine for dead and quiet pools, but noisy for busy ones.

## What is real and what is simulated (testnet)

| Real | Simulated |
|---|---|
| NEAR contract, MPC address derivation, MPC foreign-tx verification, MPC payout signatures | Market data for most **testnet test bags** (devnet tokens have no DEX market). Each has a labelled, deterministic life story |
| Solana devnet / Base Sepolia transfers, grave NFTs, events | The testnet **Séance**: a coroner feeds simulated recovery vitals so the rite runs on compressed timers. The contract still applies every rule |
| **$NGMI's market**: a real Raydium CPMM pool on devnet against tUSDC. Its liquidity, price and market cap are read by NEAR MPC, and its revival is real buys and deposits | $NGMI's volume and trader counts during the séance. tUSDC is a devnet stablecoin priced at $1 |
| Mainnet data for autopsies, the wallet scanner and the register (DexScreener, Jupiter, GeckoTerminal, RugCheck, honeypot.is) | — |

## Demo path (do X, see Y)

1. **Contract tests:** `cd contract && cargo test --lib` → 48 tests pass. Three of them reproduce live MPC attestations byte for byte: `matches_live_mpc_base_sepolia_vector`, `matches_live_mpc_solana_devnet_vector` and `matches_live_mpc_four_account_market_vector` (a Raydium pool, its vaults and mint read in one request). `mpc_read_market_replaces_reported_numbers_and_binds_the_pool` runs the live pool accounts through the contract's market path.
2. **Engine tests:** `cd web && npm install --legacy-peer-deps && npm test` → 33 tests pass: death model, rite, address derivation against live MPC-derived ossuaries, simulation conservation, owner messages that match the contract byte for byte, the same four-account MPC vector, and obituary wording.
3. **Read the registry:** `near contract call-function as-read-only necropolis.testnet get_ossuary json-args '{"chain":"sol-devnet"}' network-config testnet now` → `3dowrH8pUtmCzKR8DwsK9rHq2gBGqiV8FTzK2tZA45Mx`.
4. **Use the live app** at https://necropolis-wine.vercel.app (or run it: `cd web && cp .env.example .env.local && npm run dev`), then open:
   - `/scan`: paste any Solana or Base mainnet wallet and see its tokens triaged Dead / Critical / Fading / Alive, each with its reasons.
   - `/token/base/0x47b464eDB8Dc9BC67b5CD4C9310BB87b773845bD` ($NORMIE): the full autopsy, with death score, life chart, evidence table and provenance.
   - `/discover`: the register of 36 crashed coins, only 4 pronounced.
   - `/how#simulation`: the 60-day simulation. `/proof`: re-derive grave addresses in your browser and see live ✓ checks against the MPC network.
5. **Bury on testnet** (needs the Sexton keys in `.env.local`, funded with devnet SOL / Sepolia ETH): `/bury` → claim test bags → choose a bag → review → sign one transaction → watch finality and MPC verification → grave minted. On the grave page, **Begin séance** → stirring → risen in about 6 minutes → **Raise this grave**: the MPC network signs, and 80% lands back in your wallet.

## Run locally

Requirements: Node ≥ 20, Rust ≥ 1.95 with `wasm32-unknown-unknown`, `cargo-near` 0.23, `near-cli-rs` (all have Windows/macOS/Linux installers).

```bash
# contract
cd contract
cargo test --lib
cargo near build non-reproducible-wasm --no-abi    # → target/near/necropolis.wasm

# web
cd ../web
npm install --legacy-peer-deps
cp .env.example .env.local     # read-only works as is; burials need Sexton keys
npm run dev                    # http://localhost:3000
```

To run your own deployment: create two testnet accounts (`near account create-account sponsor-by-faucet-service …`), deploy with `new { owner_id, mpc_signer: "v1.signer-prod.testnet", network: "testnet", coroners: [sexton] }`, call `prepare_ossuary` for `sol-devnet` and `base-sepolia`, then generate Sexton keys with `npx tsx scripts/init-sexton-keys.ts`.

## Repository

```
contract/   Rust NEAR contract (near-sdk 5.30): registry, rite, MPC verification & payout builders, NEP-171
  src/foreign.rs   borsh encoder for MPC foreign-tx payloads (live test vectors)
  src/market.rs    MPC-read markets: Raydium CPMM pool, vaults, mint → liquidity, price, mcap
  src/rite.rs      resurrection state machine
  src/solana.rs    Solana message builder + on-chain ATA derivation
  src/evm.rs       EIP-1559 / RLP builder
  src/auth.rs      wallet-native ownership (ed25519 / EIP-191)
web/        Next.js 16 app
  src/core/        pure TS: death model, rite mirror, derivation, appraisal, simulation, testnet bags
  src/server/      data providers, dossiers, burial pipeline, payouts, Sexton
  src/app/         pages + API routes
```

## Hackathon tracks

- **Memecoins With Mechanics:** the product *is* a mechanic for memecoins. Burial, a contract-enforced resurrection rite with frozen terms, and an ossuary that redistributes real recovered value. The rules are public and on-chain, the sybil limits are stated above, every burial and payout is a public NEP-297 log, and there's a 60-day multi-scenario simulation.
- **Open Innovation:** a cross-chain primitive that wasn't practical before. A NEAR contract that holds Solana and Base vaults and verifies deposits into them through the MPC network, with no bridge and no NEAR wallet for users. Testnet demo with shortened timers; failure cases documented.
- **NFTs That Do Something:** a grave NFT controls a native-chain address and carries payout rights. Transfer it and the claim moves with it. Its art is a live function of on-chain state.

## Disclosure

- Built during the hackathon window (November 2026). The `pre-hackathon` tag marks the empty scaffold (`create-next-app` output); everything after it is new.
- **AI-generated code:** this project was built with Claude Code (Anthropic) acting as the engineer under the owner's direction. Research, architecture, contract, app and docs were produced in that session.
- **Libraries:** near-sdk-rs, curve25519-dalek, bs58, hex; Next.js, React, Tailwind, motion, @solana/web3.js, @solana/spl-token, wallet-adapter, wagmi/viem, @noble/curves/hashes, near-api-js, TanStack Query, zod, vitest.
- **Data providers:** DexScreener, GeckoTerminal, Jupiter, Blockscout, RugCheck, honeypot.is (public endpoints).

## Proof it works: a real end-to-end run (Solana devnet + NEAR testnet)

`npx tsx --env-file=.env.local scripts/e2e-solana.ts` drives the running app as a user with a fresh devnet wallet:

| Step | What happened | On-chain |
|---|---|---|
| Faucet | 4 test bags minted to the user; the scanner pronounced all dead ($FUMBLE 100/100) | |
| Bury | User signed one gasless transfer of 9,100,000 $FUMBLE to grave address `C5tgLY2z…veMxz` | [Solana tx](https://solscan.io/tx/3awgFH6ZkydbReg1vRceNyjD8LemK2EV8FwRVFsRkFgozAPi8HfNZe2SGZ3zyucok18WGT31pFdP76T7KejtJvUR?cluster=devnet) |
| Verify + mint | NEAR's MPC network read the grave's token account; payload hash `f6b623c0…` matched; Grave Nº 000000 minted to the user's key **19.5 s after signing** | [NEAR tx](https://testnet.nearblocks.io/txns/HyPRxRUGbvTZ4H4GPXqtzgSqB5acHHvNf91XV6Twmpc7) |
| The rite | Séance observations: began stirring → 5× still stirring → **risen** (each a NEAR transaction the contract judged) | e.g. [first observation](https://testnet.nearblocks.io/txns/EKPSytebG9xBG8B3K64gBktshMyyc6HTcFA172RnpzB4) |
| Raise | Contract built the Solana payout; MPC signed with the grave key; user's $FUMBLE 0 → **7,280,000** (80%); ossuary received **1,820,000** (20%); grave account left at 0 so a replay fails | [NEAR tx](https://testnet.nearblocks.io/txns/8UzsFnuyqChuhMioDTVvyHGZJh6SXY4u7fZY8aYUCpnT) · [Solana tx](https://solscan.io/tx/5tHZMXMW62g9gEvup5TitCmXwLhjYuvF9WMWDsz7yc59WCoTvpaWoDxBc5w8cKhyzekTg1wnnvxjZibrFfE6oqPt?cluster=devnet) |

### The ossuary pays a grave that stayed dead

Two wallets, two coins. Grave Nº 000001 ($COPIUM) belongs to wallet A and never rises. Wallet B buries $HOPIUM, and that plot rises. Wallet A's dead grave is paid from B's rising. Run with `e2e-solana.ts bury|seance|raise --user mourner --symbol HOPIUM`, then `claim --grave 1 --event 1`.

| Step | What happened | On-chain |
|---|---|---|
| Bury (wallet B) | 2,400,000 $HOPIUM → Grave Nº 000002, ossuary weight $45.25 | [NEAR tx](https://testnet.nearblocks.io/txns/386pevPuk56pA3VKbLeWhR2XYF4kX7u3ksyAomTAdm8j) |
| The rite | Six observations, then **risen**. The contract snapshots resting weight in every other plot: only grave 000001 qualifies | [rising](https://testnet.nearblocks.io/txns/HvhfPLmEdSjgyKi7E6Bx6hACSc2bNhwEmBZYfdvb8ise) |
| Raise | Wallet B gets **1,920,000** back (80%); the ossuary receives the **480,000** tithe | [NEAR tx](https://testnet.nearblocks.io/txns/14Eeb5SVRbGcwAbXQwpQs5yoD6N59N9GGotYeS2nbUun) · [Solana tx](https://solscan.io/tx/4VSD4GCgY8jnUzgZUjM36V2y4PrxHXoD7kqy8ebjFuXfTtFngHMieVM9xubPT2VFac9rbAcsjxjNFomJFayKVznS?cluster=devnet) |
| Claim (wallet A) | `get_share(1, 1)` = 432,000 (the tithe less 10% upkeep, all of it, since grave 000001 was the only resting weight). The MPC network signs from the **ossuary** key; wallet A's $HOPIUM goes up by exactly **+432,000** | [NEAR tx](https://testnet.nearblocks.io/txns/DrHvW2XjgKhnJiL8SZqfGdkmo15qWyxNBPk9ZpacSvay) · [Solana tx](https://solscan.io/tx/8PAbKfxrF1tEjCydWBfMB6Rz5tDnqyz4mX69K78P1twiasEb5AwaYajXbU1jnaZ94jnE9hWy4yje8yWY9h9V5cg?cluster=devnet) |

### Owner actions are signed by the wallet, not the relayer

`e2e-solana.ts owner --grave 1` sets Grave Nº 000001's epitaph with an ed25519 signature from wallet A over the canonical message (`Necropolis v1 / contract / action / grave / epitaph / nonce`), relayed by the Sexton:

| Attempt | Result |
|---|---|
| Same request signed by a random key | Refused: the signature doesn't match the owner (checked by the relay, and again by the contract) |
| Signed by wallet A | Epitaph set on NEAR, nonce 1 → 2 ([NEAR tx](https://testnet.nearblocks.io/txns/Ft4CU5FyBHPW6LBNugkTU2UYD9Zz3LXJj6WuPHrQjgow)) |
| The same signature replayed | Refused: nonce already used |

### A rising judged on numbers NEAR MPC read from Solana

$NGMI has a real market: a Raydium CPMM pool on Solana devnet against tUSDC (`scripts/create-test-pool.ts`). Its plot rose with **liquidity and market cap read by NEAR's MPC network**, not reported by the coroner. Run with `e2e-solana.ts bury --user keeper --symbol NGMI`, then `seance` and `raise --grave 3`.

| Step | What happened | On-chain |
|---|---|---|
| A real market | NGMI/tUSDC pool `9qdP4ijx…PPZn` opened at NGMI's dead floor: $300 tUSDC against 483.87M NGMI | [Solana tx](https://solscan.io/tx/3eA9Fv6ju8CTaCrJBme2GYnJsTgDBvNkS2fwpnxgdUZxKwrKiSBdAkEEujB1Cc9pBx3bBgVhujshNKMaGBHsjJ9f?cluster=devnet) |
| MPC reads it | One `verify_foreign_transaction` read the pool state, both vaults and the mint; payload hash `92235a8b…` matched our encoder (now a contract test vector) | [NEAR tx](https://testnet.nearblocks.io/txns/6KQogkUWrkhDJcFwaF6HEGReQodbVkeE3HjmvY298YzB) |
| Bury | 40,000,000 $NGMI → Grave Nº 000003 | [NEAR tx](https://testnet.nearblocks.io/txns/2HMYA7sCjmYduadQFw1E1ZnBDtcD2j844qGjkKZErp4E) |
| Bound while dead | First `observe_market`: the contract computed **$600 liquidity, $374 market cap** from MPC-read accounts and bound the pool to the plot. Resting | [NEAR tx](https://testnet.nearblocks.io/txns/Gqzajro4Agh3zGkH2m71UEZTyTW9kqjtbd3Fsa5iR5HM) |
| A real comeback | The séance buys NGMI up to $0.0006, then liquidity returns to 60k tUSDC: real devnet trades | [buy](https://solscan.io/tx/4XpdZf8jMPAP6TjhSmwfLE3hsCA7UFkQ533UZqDfDVbNoUJLHsgixej8hiTeJwr6wyjnvdz8VWPN7YXFNu1wnFrH?cluster=devnet) · [deposit](https://solscan.io/tx/2HKaKrgrdNTGJqRHrxNb5RtXESgdLSmcnZCdHQg8PDP71c29kc6ih9zCG1RuSapTvucpyuH7kzDDpG4qfpBvKX8W?cluster=devnet) |
| The rite, MPC-read | Six readings, each with **$118,987 liquidity and $363,060 market cap read by MPC** (volume and traders simulated): began stirring → still stirring ×4 → **risen** | [first](https://testnet.nearblocks.io/txns/8rzUJLf37pqX6hEj3JpjUiGbECoRd5E57UcRfh6Hr9LH) · [rising](https://testnet.nearblocks.io/txns/DTnrpptUS9XBkHLg29yUL1hKRoLh6wXiUna81uAaR7JA) |
| Raise | The keeper's $NGMI 0 → **32,000,000** (80%); 8,000,000 to the ossuary | [NEAR tx](https://testnet.nearblocks.io/txns/ExtHFMcobaS5nLhtrHnE2cwq92VQowXebpmuMhycM8gK) · [Solana tx](https://solscan.io/tx/65Bc5j1P2b2ZsnanyG3LYEoLFDU9j3ERcVFTiiLDrR146YeSF1PnZtjjRXXgaokoELkmEkU33hp9Nt44xacMNAex?cluster=devnet) |
| Paid again | Grave Nº 000001 ($COPIUM, still dead) claims its share of this rising too: **+7,200,000 $NGMI**. It has now been paid from two different coins' risings | [NEAR tx](https://testnet.nearblocks.io/txns/DafMGqGcn9iXu5fnP4LSE56ZP4rAYPjLSnz5UDLtwdyA) · [Solana tx](https://solscan.io/tx/4AE9hdJ4QXmEiX1174mJkHcdREjGwWt5FDpPRKK2v9yzKci2Kj4pDx6VKZv1FuYDtn9EsTykjwueQcHSU8bs3HkL?cluster=devnet) |

See it on the grave page: `/grave/3` shows the bound pool, the MPC payload hash and an **MPC** badge on every number the coroner didn't get to say.

## Status

- ✅ Contract deployed to NEAR testnet; MPC derivation and verification proven against live attestations.
- ✅ Full burial → rite → MPC-signed payout completed on Solana devnet (above).
- ✅ Ossuary shares proven live: a dead grave was paid from another coin's rising, signed by the ossuary's MPC key (above).
- ✅ Wallet-signed owner actions (epitaph, payout address, transfer) from the grave page's **Keeper's ledger**, with forgery and replay refused.
- ✅ **NEAR MPC as the coroner:** a plot rose on liquidity and market cap the contract computed from Solana accounts the MPC network read: a real Raydium devnet pool, revived with real trades (above).
- ✅ **Wallet obituaries:** after a scan, `/obituary/<chain>/<address>` turns the result into a share card, with one headstone per dead coin and a glowing one for each coin whose plot rose.
- ✅ **Demo video:** `cd web && npx tsx scripts/record-demo.ts` records a captioned nine-scene walkthrough of production with Playwright (`web/demo/necropolis-demo.webm`). With `FFMPEG=<path>` it also writes an X-ready MP4, with the warm-up trimmed. Every scene reads real chain state. The launch thread is in [`docs/launch/x-thread.md`](docs/launch/x-thread.md).
- ✅ **Candles and boards:** any Solana or EVM wallet can light one candle per grave by signing a message (no fee, relayed). The contract verifies the signature and keeps the count. The cemetery shows **Most mourned** and **Biggest graves** boards. A forged candle and a second candle from the same wallet are both refused ([first candle](https://testnet.nearblocks.io/txns/GPDLUnHwyizLC1SLzBa32XR33WBqmxWxTrUkovq1FDir)).
- ✅ App: landing, cemetery, scanner, autopsy, register, burial flow, grave pages with séance/raise/claims, how-it-works, proof, share cards, PWA (manifest, icons, offline shell).
- ✅ Tests: 48 contract (incl. three live MPC vectors), 33 unit, 9 Playwright smoke (desktop + mobile); `npm run lint` clean.
- ⏳ Base Sepolia end-to-end run: waiting on Sepolia ETH for the Sexton (the code path is built and typechecked).
- ✅ Hosted at https://necropolis-wine.vercel.app (Vercel). A second real burial ran against production: Grave Nº 000001 ($COPIUM) minted 20.7 s after signing ([NEAR tx](https://testnet.nearblocks.io/txns/8XY71n79EGuB3XkkdsNK19ijaE7X1DFc6aw4jCoPUv3s)). Grave NFTs resolve their live art via `base_uri` → `/api/grave/<id>/image.svg`.
- Mainnet is intentionally closed until the contract is audited.

## License

MIT, see [LICENSE](LICENSE).
