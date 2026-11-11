# Necropolis

**A graveyard for dead memecoins on Solana and Base.** You bury a dead token on its own chain, NEAR's MPC network verifies the burial, and if the coin ever *objectively* comes back you get 80% of it back. Every grave is an NFT that controls its own keyless NEAR account, and burying mints **$BONES** (NEP-141) into it: a share of the 20% every other coin pays when it rises. Sell the grave and all of that goes with it.

> You give up 20% of a lottery ticket you'd forgotten about. You get a share of every other ticket in the ground.

*Not affiliated with necropolis.fund, an unrelated Robinhood Chain project that funds bonding-curve graduations. This Necropolis buries Solana and Base tokens and verifies them on NEAR.*

| | |
|---|---|
| **Contract** | [`necropolis.testnet`](https://testnet.nearblocks.io/address/necropolis.testnet) (NEAR testnet) |
| **MPC signer** | [`v1.signer-prod.testnet`](https://testnet.nearblocks.io/address/v1.signer-prod.testnet) (Chain Signatures + foreign-chain verification) |
| **Origin chains** | Solana devnet, Base Sepolia (mainnet chains are coded but closed) |
| **Live demo** | **https://necropolis-wine.vercel.app** (testnet) |
| **Token** | **$BONES**, NEP-141 on `necropolis.testnet` (`ft_metadata`, `ft_balance_of`, `ft_transfer`, `ft_transfer_call`). Rules: `get_bones_rules`, log: `get_bones_log` |
| **NFT** | Graves, NEP-171/177 on `necropolis.testnet`. Grave *N* controls `gN.necropolis.testnet`, a NEAR account with no access keys |
| **Judge desk** | [`/verify`](https://necropolis-wine.vercel.app/verify) or `cd web && npm run verify`: every live claim below, re-checked from public RPCs (**10/10 hold**) |
| **Tracks** | Memecoins With Mechanics · Open Innovation · NFTs That Do Something ([brief map](#brief-map)) |

## See it in 60 seconds

0. **Don't trust any of this. Check it.** [`/verify`](https://necropolis-wine.vercel.app/verify) re-derives every vault address, finds every deposit on its own chain, confirms every grave account has no keys and that $BONES supply equals minted minus burned, straight from NEAR, Solana and Base RPCs. `npm run verify` does the same in a terminal. Below it are the attacks we sent to the contract and the transactions in which it refused them.
1. **A rising judged by NEAR MPC, not by us.** Open [`/grave/3`](https://necropolis-wine.vercel.app/grave/3). $NGMI trades in a real Raydium pool on Solana devnet. NEAR's MPC network read the pool, both vaults and the mint in one request, and the contract computed liquidity and market cap itself. The plot rose on those numbers. The page shows the pool, the MPC payload hash and the transactions ([proof below](#a-rising-judged-on-numbers-near-mpc-read-from-solana)).
2. **$BONES pays the graves that stay dead.** [`/grave/1`](https://necropolis-wine.vercel.app/grave/1) never rose, and has been paid by three other coins' risings: twice per grave, then through its owner's $BONES. Since $BONES, every rising pays BONES holders. When $LAZARUS rose, its burier's BONES burned and the tithe went 56.56 : 40 to two holders, one of whom only received BONES by transfer ([proof below](#bones-pays-whoever-held-it-at-the-rising)).
3. **Who died in your wallet?** [`/scan`](https://necropolis-wine.vercel.app/scan): paste any Solana or Base wallet and every token gets a death score with its evidence. Then share the obituary.
4. **A grave sold in the middle of a payout.** Grave X (below) held BONES when $PHOENIX rose, then was sold before anyone claimed. The claim paid the buyer. The seller's attempts to exhume, redirect, claim or re-sell were refused by the contract, and the seller's wallet can no longer open the grave's [crypt](#graves-are-accounts). See [the run](#a-grave-sold-in-the-middle-of-a-payout).
5. **$BONES, in the open.** [`/bones`](https://necropolis-wine.vercel.app/bones): the rules as the contract states them, the parameters (and the empty list of methods that can change them), and every mint and burn.
6. **Try it yourself, no wallet.** On the live app, **Connect → Use a throwaway wallet**, then [`/bury`](https://necropolis-wine.vercel.app/bury): claim test bags, bury one, and your grave (with its own account and BONES) is minted in about 20 seconds. Already on NEAR? Connect a NEAR wallet to hold graves and BONES in your account.
7. **Watch it:** a 90-second captioned walkthrough of production, recorded by [`web/scripts/record-demo.ts`](web/scripts/record-demo.ts).

## $BONES: a token whose supply follows the dead

| | |
|---|---|
| **Mint** | When you bury a dead coin with ossuary weight: 1 BONES per $1 of weight, **into the grave's own account** (`gN.necropolis.testnet`), so it belongs to whoever holds the grave NFT. Supply grows as coins die. |
| **Burn** | When a coin's plot rises, the BONES still inside its graves are burned. BONES already exhumed and sold stay out there. Supply shrinks as coins come back. |
| **Pay** | Each rising's ossuary pool (the 20% tithe, less a tenth of it for upkeep) is split among BONES holders by their balance **at the moment of the rising**, read from on-chain checkpoints. BONES bought after a rising gets nothing from it, so burying junk after the fact can't skim a payout. Paid in the risen coin, signed out of the ossuary by NEAR MPC. |
| **Move** | The holder can exhume BONES from the grave to their wallet (signed). From there they're an ordinary NEP-141: `ft_transfer` / `ft_transfer_call` (DEX-compatible) for NEAR accounts; Solana and EVM holders sign a message and the relayer pays gas. |
| **Read** | `get_bones_rules()` returns every parameter and `setters: []`: **no method can change the mint rate, tithe, upkeep or death-score floor.** `get_bones_log()` lists every mint and burn with the supply after it, also emitted as NEP-141 `ft_mint` / `ft_burn` events. Both on [`/bones`](https://necropolis-wine.vercel.app/bones). |
| **Code** | [`contract/src/bones.rs`](contract/src/bones.rs). State lives under its own storage keys, so the upgrade needed no migration. Risings before genesis keep their per-grave shares. |

## Graves are accounts

*The NFTs That Do Something brief, answered.* Every grave NFT controls a NEAR sub-account, `g<id>.necropolis.testnet`, created by the contract **with no access keys**: nobody can sign for it, its burier included. Only the contract moves what it holds, and only for whoever holds the NFT at that moment. Code: [`contract/src/accounts.rs`](contract/src/accounts.rs).

What the account holds, and so what a sale hands over:

- the **vault** on Solana or Base (an MPC address only the contract can sign for), and the 80% owner share if the coin rises;
- the grave's **$BONES**, minted into it at burial, and every **unclaimed share** of other coins' risings they earned;
- the **right to act** for it: exhume BONES, set the payout address, set the epitaph, hand it on.

**How control passes on transfer.** `nft_transfer` (or a wallet-signed `transfer_grave`) changes one field, the grave's `owner_id`. Every action on the grave and its account checks that field *at the moment of the action*: named NEAR owners must be the caller; wallet owners must sign the canonical message with the key the owner id encodes, under a per-owner nonce. Claims for the grave's account pay `default_recipient(grave)`, which is computed from the current owner. The transfer also clears the old payout address.

**What stops the old owner keeping access**, every way we could think of, each with its test and a live refusal on [`/verify`](https://necropolis-wine.vercel.app/verify):

| A seller tries to… | Why it fails | Test · live |
|---|---|---|
| keep a share that was earned before the sale but not yet claimed | Shares belong to the grave's account, not to a person. A claim made after the sale pays the current holder | `a_sale_in_the_middle_of_a_payout_pays_the_buyer` · live run below |
| claim it before the sale to their own key, then sell | Allowed, and the buyer can see it: the share is marked claimed and the payout is in the grave's history. It can't be claimed twice | `a_claim_made_before_the_sale_stays_with_the_seller` |
| exhume the grave's BONES after selling | `exhume_bones` checks the signature against the current owner | same test · refused on testnet |
| point payouts at their own wallet after selling | Same check; and the transfer already cleared their payout address | refused on testnet |
| claim the grave's share to their own wallet after selling | A custom recipient needs the current owner's signature | refused on testnet |
| sell or hand the grave on a second time | `transfer_grave` checks the current owner | refused on testnet |
| replay a signature they made while they owned it | Per-owner nonces: every signature is used once, and the new owner's nonce is separate | `wallet_holders_move_bones_with_a_signature` · refused on testnet |
| hold a key to the grave's account | It was created with none, and nothing can add one: only the contract acts for it | `/verify` checks every account has 0 keys |
| use the relayer to act without a signature | The contract requires the owner's signature itself; the relayer only pays gas | refused on testnet |
| open the grave's crypt (holder-only page) | The server checks a fresh, time-boxed signature against `get_grave` at a final block | refused in the live run |

**Per-grave history.** `get_grave_history(id)` records what the grave earned, what it paid out and who held it: buried, BONES minted, earned (per rising, with the recipient), raised, BONES burned, exhumed, changed hands, epitaph. It's on every grave page and in the crypt.

**The crypt.** `/crypt/<id>` is a page only the grave's current holder can open. The wallet signs a short, time-boxed message (no transaction, no fee); a grave held by a named NEAR account signs in with NEP-413, and the server also checks the key is one of that account's full-access keys. The server reads `get_grave` at a fixed final block and checks the signature against that owner, so the moment a grave changes hands the old holder's wallet is turned away. Inside: the holder's statement (earned per coin, BONES in and out, every holder so far) and a CSV of the full history.

**Limits, stated plainly.** Graves buried before the accounts upgrade minted their BONES to their burier, not into the grave; their pages say so. A Solana-family owner whose grave is owed a share on an EVM chain (or the reverse) must set a payout address on that chain before claiming. The holder-gated page is gated by our server's check, the data in it is public on-chain.

## Who verifies the deposit?

Cross-chain apps differ most in one place: who says the money arrived.

| Approach | Who you trust | Necropolis |
|---|---|---|
| A watcher or oracle reports the deposit | The watcher's key | — |
| Arrivals simulated with mock intents | Nobody checks; it's a demo | — |
| A bridge mints a wrapped token | The bridge | — |
| **NEAR MPC reads the deposit from the origin chain** (`verify_foreign_transaction`, with the payload hash computed by the contract) | NEAR's MPC network, the same one that holds the vault keys | Every burial, and every market reading of a pool-bound plot |

---

## The problem

Memecoins die at industrial scale. CoinGecko counts **11.6 million** tokens that stopped trading in 2025. Only about 4.5% of pump.fun tokens trade past day 90, and 98.6% of Solana memecoins end with under $1,000 of liquidity (Solidus Labs). The positions don't disappear: they sit in wallets as clutter, get hidden by spam filters, or get burned for a few cents of rent. Every existing tool treats a dead token as waste. None keeps the holder's claim on a possible recovery, and none pools those claims.

## The idea

1. **Bury.** Send a dead token to its own *grave address* on its native chain. The address is derived from the Necropolis contract through NEAR Chain Signatures, so nobody holds its key. Only the contract can ever ask NEAR's MPC network to sign for it.
2. **Verify.** NEAR's MPC network reads the deposit directly from Solana or Base (`verify_foreign_transaction`). The contract mints a **grave**, an NEP-171 token owned by your own wallet key, only if that attestation matches the claimed deposit byte for byte.
3. **The rite.** Coroners report vital signs. The contract decides, using terms frozen when the token's plot opened, whether the token is stirring, has had a false dawn, or has risen. A pump is not a pulse: the recovery must hold for 14 consecutive days on liquidity, volume, traders, market cap, wash-trading limits and source agreement.
4. **Raise.** When a plot rises, the contract builds the payout transactions itself and the MPC network signs them. 80% goes back to each grave's owner, and 20% (the tithe) goes to the ossuary. The ossuary is shared pro rata by **$BONES** holders at the moment of the rising.

There is no yield. The only value in the system is the buried coins, and they only matter if they recover. $BONES is your share of them.

## Why NEAR (and why it couldn't be built elsewhere the same way)

| NEAR primitive | What Necropolis uses it for |
|---|---|
| **Chain Signatures** (EdDSA domain 1, ECDSA domain 0) | Every grave and ossuary is an address on Solana or Base that the contract controls. Payouts are transactions **the contract builds itself**: Solana legacy messages with on-chain ATA derivation, and EIP-1559 ERC-20 transfers with in-contract RLP. The MPC network signs them. Relayers cannot redirect a payout. |
| **Foreign-chain transaction verification** (`verify_foreign_transaction`, MPC v3.18) | Burials are verified **trustlessly** by the MPC network. On Base it reads the ERC-20 `Transfer` log; on Solana it reads the grave's token-account state. The contract supplies the expected payload hash and the MPC contract rejects any mismatch. The same primitive makes **NEAR MPC the coroner for markets**: one request reads a Raydium pool, its vaults and the token's mint, and the contract computes liquidity, price and market cap for the rite itself (`contract/src/market.rs`). Our borsh encoder is tested against three live testnet attestations (`contract/src/foreign.rs`). |
| **Implicit accounts + host crypto** | Graves are owned by your own key, expressed as a NEAR implicit account: a Solana key is a 64-hex account, an EVM address is a NEP-518 eth-implicit account. Owners act by signing a message in Phantom or MetaMask, verified on-chain with `ed25519_verify` / `ecrecover`. **Users never need a NEAR wallet or NEAR tokens.** |
| **NEP-141 fungible token** | **$BONES**, the ossuary as a token: minted at burial, burned at rising, split by balance at each rising. One contract holds the graves and the token, so supply rules are enforced where the burials and risings happen. |
| **NEP-171/177 NFTs** | A grave is a functional NFT: it is the claim on a native-chain address and on the 80% owner share. Its image is live and evolves with plot state (fresh → mossy → stirring → risen). |
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
- **Ossuary:** each rising creates an event that records the $BONES supply at that moment; each holder can claim `pool × balance at the rising / supply at the rising`. Since BONES are minted per dollar of resting weight, that is the same split as by weight, but the claim is a token you can move. (Risings before $BONES began paid each resting grave by weight.) 10% of the tithe (2% of the plot) is upkeep.
- **Weight** is salvage value at burial: amount × 7-day average price. Each plot's total weight is capped at its real liquidity ($50–$25k). A grave with a death score under 60 is unmarked: it can rise, but carries no weight.
- **Who pays whom:** owners of a risen plot pay 20% of their recovered tokens to everyone else in the cemetery. A single dead bag is a near-worthless lottery ticket; a grave is a share in every resurrection while it rests.
- **What you give up:** there is no early exit, and if the coin never recovers it stays buried.
- **60-day simulation:** `web/src/core/simulation.ts` models four futures (graveyard, rare revivals, memecoin summer, wash-trading attack) with the contract's exact payout split, and tracks $BONES through them: minted, burned, supply on day 60, and what one BONES held for all 60 days was paid. It's interactive on [`/how#simulation`](https://necropolis-wine.vercel.app/how#simulation); `simulation.test.ts` checks that the split is exactly 80/18/2, that supply only falls on a rising, and that a graveyard pays nothing.

## Security model

| Actor | Can | Cannot |
|---|---|---|
| NEAR MPC network | Sign for grave/ossuary addresses when the contract asks; attest foreign transactions | Sign anything the contract didn't build (threshold MPC) |
| Necropolis contract | Build payouts: raise (owner + ossuary only), ossuary claims (pro rata) | Send buried tokens anywhere else; mint a grave without a matching MPC attestation |
| Coroner (Sexton) | Appraise burials (value, weight); report vital signs. On plots bound to a pool, only volume and trader counts | Move tokens; fabricate deposits; decide resurrection (the contract does); report liquidity, price or market cap for a pool-bound plot (NEAR MPC reads them) |
| Relayer (Sexton) | Pay fees; broadcast transactions anyone could broadcast; relay owner-signed actions (it checks the signature first, so forgeries cost it nothing) | Redirect payouts: destination accounts are derived on-chain. Forge, alter or replay an owner action: the contract verifies the signature and nonce itself |
| Grave owner | Transfer the grave; set epitaph or payout address; exhume BONES from the grave's account, all via wallet signature (nonce-protected) | Withdraw before the plot rises; act for the grave after selling it |
| Contract owner (method calls) | Add/remove coroners; set NFT base URI; start $BONES once; open accounts for graves dug before the upgrade | Change a plot's frozen terms or the $BONES rules (no setter exists); touch buried tokens or a grave's BONES |
| Contract account's access key | Deploy new code (it's a testnet deployment under active development) | Nothing else. **Until that key is deleted, the code can be replaced**; `/verify` reports the key count live |

**Main trust assumption: the coroner, and how much of it NEAR MPC removes.** A dishonest coroner can stall a rising or mis-appraise weights. It can't steal buried tokens or mint graves without real deposits.

The rite's hardest numbers (liquidity, price, market cap) are no longer the coroner's word. A Solana plot can be bound to its Raydium CPMM pool. After that, each reading is a single `verify_foreign_transaction` in which **NEAR's MPC network reads four accounts**: the pool state, both vaults and the token's mint. The contract computes the numbers itself:

- liquidity is 2× the stablecoin reserve, net of accrued fees;
- price is the reserve ratio;
- market cap is price × the mint's supply.

The coroner only supplies copies, and if the MPC network reads anything different, nothing is applied. The vault and mint keys come out of data the AMM program wrote, so they can't be swapped. MPC reads are live (`getAccountInfo` at a slot no earlier than the anchor transaction), so an old state can't be replayed. A bound plot refuses unverified readings and any other pool.

What's left on the coroner's word is volume and trader counts, which aren't account state. The hardening path for those is multiple independent coroners with an on-chain quorum.

### Sybil limits & failure cases

- **Many wallets get nothing extra.** BONES are minted per dollar of weight, not per wallet or per grave, and every share is pro rata on BONES. Splitting one bag across a hundred wallets mints the same BONES and earns the same share as burying it from one.
- **Farming ossuary weight (and so $BONES) with fake dead tokens.** BONES are only minted for weight, and weight is capped by the plot's real liquidity and requires a death score of 60 or more, so an attacker must lock real liquidity in a token that then stays dead. Burying after a rising can't skim it: payouts follow balances at the rising. Residual risk: liquidity-time is cheap for a patient attacker.
- **Burying a live coin to farm BONES** fails twice: a live coin scores under 60 and earns no weight, and if it rises its graves' BONES are burned before its pool is split.
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

0. **Judge desk:** `cd web && npm install --legacy-peer-deps && npm run verify` → `10/10 claims hold` (plus a note on the contract key), from public RPCs only. Same checks at `/verify`.
1. **Contract tests:** `cd contract && cargo test --lib` → 58 tests pass, including `a_sale_in_the_middle_of_a_payout_pays_the_buyer`, `a_claim_made_before_the_sale_stays_with_the_seller` and `bones_rules_are_readable_and_every_mint_and_burn_is_logged`. Three of them reproduce live MPC attestations byte for byte: `matches_live_mpc_base_sepolia_vector`, `matches_live_mpc_solana_devnet_vector` and `matches_live_mpc_four_account_market_vector` (a Raydium pool, its vaults and mint read in one request). `mpc_read_market_replaces_reported_numbers_and_binds_the_pool` runs the live pool accounts through the contract's market path.
2. **Engine tests:** `cd web && npm test` → 36 tests pass, including NEP-413 sign-in verified against near-api-js's own signer: death model, rite, address derivation against live MPC-derived ossuaries, simulation conservation and $BONES supply, owner and $BONES messages that match the contract byte for byte, the same four-account MPC vector, and obituary wording.
3. **Read the registry:** `near contract call-function as-read-only necropolis.testnet get_ossuary json-args '{"chain":"sol-devnet"}' network-config testnet now` → `3dowrH8pUtmCzKR8DwsK9rHq2gBGqiV8FTzK2tZA45Mx`.
4. **Use the live app** at https://necropolis-wine.vercel.app (or run it: `cd web && cp .env.example .env.local && npm run dev`), then open:
   - `/scan`: paste any Solana or Base mainnet wallet and see its tokens triaged Dead / Critical / Fading / Alive, each with its reasons.
   - `/token/base/0x47b464eDB8Dc9BC67b5CD4C9310BB87b773845bD` ($NORMIE): the full autopsy, with death score, life chart, evidence table and provenance.
   - `/discover`: the register of 36 crashed coins, only 4 pronounced.
   - `/how#simulation`: the 60-day simulation. `/proof`: re-derive grave addresses in your browser and see live ✓ checks against the MPC network.
5. **Bury on testnet, no wallet needed.** On the live app: **Connect → Use a throwaway wallet** (a Solana devnet key kept in your browser; the relayer pays every fee), then `/bury` → claim test bags → choose a bag → review → sign → watch finality and MPC verification → grave minted, with its BONES in its own account. Open `/crypt/<id>` and sign to enter. (Running your own copy needs the Sexton keys in `.env.local`, funded with devnet SOL / Sepolia ETH.) On the grave page, **Begin séance** → stirring → risen in about 6 minutes → **Raise this grave**: the MPC network signs, and 80% lands back in your wallet.

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
  src/bones.rs     $BONES (NEP-141): mint, burn, record-date split, rules, log
  src/accounts.rs  graves as keyless accounts, exhume, per-grave history
web/        Next.js 16 app
  src/core/        pure TS: death model, rite mirror, derivation, appraisal, simulation, testnet bags, verify (judge desk)
  scripts/         verify.ts (npm run verify), e2e-solana.ts, e2e-accounts.ts (sale mid-payout + attacks), record-demo.ts
  src/server/      data providers, dossiers, burial pipeline, payouts, Sexton
  src/app/         pages + API routes
```

## Brief map

Every requirement in the three track briefs, and where to check it.

**NFTs That Do Something**

| The brief asks for | Where it is | Status |
|---|---|---|
| An NEP-171 token that controls something | Graves: NEP-171/177 on `necropolis.testnet`. Each controls a keyless sub-account `gN.necropolis.testnet` (its $BONES, its unclaimed earnings, the right to act for it) and an MPC vault on Solana or Base | Met · `/verify` checks every account has 0 keys |
| How control passes on transfer, and what stops the old owner keeping access | [Graves are accounts](#graves-are-accounts): one `owner_id`, checked at every action; a table of every way a seller could keep money | Met |
| A page only the holder can open | `/crypt/<id>`: wallet-signed, checked against `get_grave` at a final block; the seller is refused after a sale | Met · live run below |
| Per-NFT history: earned, paid out, holders | `get_grave_history(id)`, on every grave page and in the crypt (with CSV) | Met |
| Tests for the transfer path, including a sale in the middle of a payout | `a_sale_in_the_middle_of_a_payout_pays_the_buyer`, `a_claim_made_before_the_sale_stays_with_the_seller`, plus the same story live on testnet with every seller attack refused | Met |
| A threat model | [Graves are accounts](#graves-are-accounts) and [Security model](#security-model) | Met |

**Memecoins With Mechanics**

| The brief asks for | Where it is | Status |
|---|---|---|
| An NEP-141 token with the mechanic in the contract | $BONES in [`bones.rs`](contract/src/bones.rs): minted per dollar of dead weight, burned when its coin rises, paid by balance at every rising | Met |
| Parameters readable, no admin key that can change them | `get_bones_rules()` returns every parameter and `setters: []`; no method changes them. The contract account still has an access key that could deploy new code ([Security model](#security-model)); `/verify` shows it live | Partly, until that key is deleted |
| Sybil limits documented | [Sybil limits & failure cases](#sybil-limits--failure-cases) | Met |
| A page with a log of every mint and burn | [`/bones`](https://necropolis-wine.vercel.app/bones), from `get_bones_log()`; `/verify` checks supply = minted − burned | Met |
| A 60-day simulation | [`/how#simulation`](https://necropolis-wine.vercel.app/how#simulation): four futures, with $BONES supply and payout per BONES | Met |

**Open Innovation**

| The brief asks for | Where it is | Status |
|---|---|---|
| The rules live in a contract | The rite ([`rite.rs`](contract/src/rite.rs)), payouts built in-contract, MPC verification of deposits and markets | Met |
| A testnet demo with short timers | Testnet terms: a 6-minute window instead of 14 days; every run below | Met |
| Failure cases in the README | [Sybil limits & failure cases](#sybil-limits--failure-cases) | Met |

## Hackathon tracks

- **Memecoins With Mechanics:** **$BONES** is an NEP-141 token with the mechanic in the contract. Its supply reacts to the cemetery: minted as coins die, burned as they rise. Its holders split a treasury with rules (the ossuary) at every resurrection, and the rite and candles are on-chain rituals. The rules are readable and have no setter, the sybil limits are stated above, every mint and burn is logged on chain and shown on `/bones`, and there's a 60-day multi-scenario simulation.
- **Open Innovation:** a cross-chain primitive that wasn't practical before. A NEAR contract that holds Solana and Base vaults and verifies deposits into them through the MPC network, with no bridge and no NEAR wallet for users. Testnet demo with shortened timers; failure cases documented.
- **NFTs That Do Something:** a grave NFT controls a keyless NEAR account and a native-chain vault. Its $BONES and unclaimed earnings live in that account, so selling the grave hands them to the buyer, mid-payout included. A holder-only crypt, a per-grave history, and a threat model of every way a seller could try to keep the money. Its art is a live function of on-chain state.

## Disclosure

- Built during the hackathon window (November 2026). The `pre-hackathon` tag marks the empty scaffold (`create-next-app` output); everything after it is new.
- **Other submission:** the author also entered **[Sudo by Contract](https://github.com/BoyofMars/sudo-by-contract)**, an independent project: short-lived, policy-bound SSH access for AI agents, with NEAR's MPC network as an SSH certificate authority that has no private key. The two projects share no code.
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

### $BONES pays whoever held it at the rising

The first rising under $BONES, end to end. Wallet A (grave 000001's owner) holds the genesis BONES, sends 40 to wallet B with a signature, then $LAZARUS rises. Run with `e2e-solana.ts bones-send --to mourner --amount 40`, `bury|seance|raise --user keeper --symbol LAZARUS`, then `bones-claim --event 3` for each wallet.

| Step | What happened | On-chain |
|---|---|---|
| Genesis | `bones_genesis` minted **96.559904 BONES** to grave 000001's owner, the only grave still resting with weight. Risings from #3 on pay holders | [NEAR tx](https://testnet.nearblocks.io/txns/9yLr8LhhjnQkypPffmVowJrmKxWefL7zu1X1iUnRToGb) |
| Signed transfer | Wallet A sends 40 BONES to wallet B with an ed25519 signature, relayed by the Sexton. The replay is refused | [NEAR tx](https://testnet.nearblocks.io/txns/DZBwGZeitgaTvcbDFn8Y1PKJxn6m2DWPPwGS4MqremZp) |
| Bury | 8,000,000 $LAZARUS → Grave Nº 000004, minting **110.33 BONES** to its burier (supply 206.89) | [NEAR tx](https://testnet.nearblocks.io/txns/7WZeXUjMaKQuosTnmXi3yPdLDbFL1c2pq7qNAk76v9hw) |
| The rite | Six observations, then **risen**. At that moment the burier's 110.33 BONES are **burned** (supply back to 96.56), and the 1,440,000 $LAZARUS pool is recorded against balances of 56.56 : 40 | [rising](https://testnet.nearblocks.io/txns/FirjkVXH7TVewjzh9aKtBqt5WD4NEduQxvgQrQXiESsP) |
| Too early | A claim before the grave was raised is refused: the tithe isn't in the ossuary yet | |
| Raise | The burier gets 6,400,000 back (80%); the 1,600,000 tithe goes to the ossuary | [NEAR tx](https://testnet.nearblocks.io/txns/F5TXsEJpeMZ986FJKNqaNcNo8fxXx5hc9tak1x2wdPoZ) · [Solana tx](https://solscan.io/tx/3MB9qZFwmj32r3DmHz4mPsnTefhZ4SvzfTw3sJ3rooWyzgMjRyssqvJEg7XfuPAsdA93saCfZvDiFqfGC6S4Kzov?cluster=devnet) |
| Claim (A) | Wallet A, which buried a coin that never rose: **+843,479.11 $LAZARUS** | [NEAR tx](https://testnet.nearblocks.io/txns/DpPsTfRjr7w87Jt6g541BDs8VfpXQ98uF84Xpgd6oyhR) · [Solana tx](https://solscan.io/tx/2XGDmWgC2qosVfB7acg2R7UHxiBGdKiHsUhCKwqq16hscFq26Ej6uXGKMrAosJ58DzPNaeNEqFHLXHYbhbYga1CC?cluster=devnet) |
| Claim (B) | Wallet B, whose BONES came by transfer and who had nothing resting in the ground: **+596,520.89 $LAZARUS**. A second claim is refused | [NEAR tx](https://testnet.nearblocks.io/txns/3hhniidYH9CpwTwAQP6W3YuWRWRfYgruq7xL22zfcgPe) · [Solana tx](https://solscan.io/tx/WBKMo9EnLGUGXdQSF8rBhwjvWSNetfcNcXE3zXBYpXRHYouvt5v8r3ZM7twNc6hKjkYLoWG9sfH9Z5Wi7JsCiu1?cluster=devnet) |

### A grave sold in the middle of a payout

The NFT brief's hard case, live. Three fresh wallets: a seller, a buyer, and a riser whose coin comes back. Every seller attack is sent **straight to the contract**, skipping our server's checks, the way a malicious relayer would. Run with `npx tsx --env-file=.env.local scripts/e2e-accounts.ts`; the refusals land in [`web/testnet-refused.json`](web/testnet-refused.json) and on [`/verify`](https://necropolis-wine.vercel.app/verify), which re-checks each one on an archival node.

| Step | What happened | On-chain |
|---|---|---|
| Bury (seller) | 1,300,000 $COPIUM → Grave Nº 000005. **96.56 BONES minted into `g5.necropolis.testnet`**, the grave's own keyless account | [NEAR tx](https://testnet.nearblocks.io/txns/D8bSvg9j586AgjyqCGUZgCTYyuRyZ9bBXgMQ9BpdwH2w) |
| Bury (riser) | 6,000,000 $PHOENIX → Grave Nº 000006, 84.94 BONES into `g6` | [NEAR tx](https://testnet.nearblocks.io/txns/59a9Pc5eMNH2bEy1S7PixDDLa95M76AT38PPVXZkm6z3) |
| The rite | Seven observations, then **risen**. `g6`'s BONES burn; `g5` held 96.56 of 193.12 BONES, so grave 5 is owed **540,000 $PHOENIX** | |
| Too early | A relayer tries to exhume grave 5's BONES with no signature; anyone tries to claim before the tithe is in. Both refused | [no signature](https://testnet.nearblocks.io/txns/4X2pkWcEChKQXvw66wDtWqDPqyx1UdbsyiuSonL1Nnsy) · [too early](https://testnet.nearblocks.io/txns/8HUiL3mmTLivZHfj3bAAVzxXCtffoz7SzZcrFuf9SZGP) |
| Raise | The riser's PHOENIX comes back; the tithe reaches the ossuary | [NEAR tx](https://testnet.nearblocks.io/txns/3Y75szk1wq8Gc5gDVPqnUjqm84ro1iZDkuqnrRVySHPz) · [Solana tx](https://solscan.io/tx/4oeSHKLBF1FSuRaR39apWRW82kZEiYDr8Fk3tA1b2o27wubKJkDw8pVog22XQ8sw9ycdtB1rueHRpao5RRyt7WkQ?cluster=devnet) |
| **The sale** | The seller hands grave 5 to the buyer with a wallet signature. **The share is still unclaimed** | [NEAR tx](https://testnet.nearblocks.io/txns/B8NGyV4Dh3BrEQMKtUj6WJs9aS5hvznzv5FiYqJKDKc2) |
| The crypt | The seller's wallet is turned away ("held the grave once; the crypt went with it"); the buyer's opens it, checked at NEAR block #277,247,524 | off-chain check |
| The seller fights back | Exhume the BONES, point payouts at their own wallet, claim the share to their own wallet, sell the grave again: **all refused**, `invalid owner signature` | [exhume](https://testnet.nearblocks.io/txns/3v5KhC6GY1umiuHmGc9GYVB1Yt33RTeA2btapXYzC2UE) · [payout](https://testnet.nearblocks.io/txns/DP9hDu2yD8Db5e8ArBem6QD1ed19rCQ7MpybdwbEtPC7) · [claim](https://testnet.nearblocks.io/txns/8pAAf3MdK9RuaEeTEtBCWvQpuSwXypDgZkwGrdTcdFUM) · [resell](https://testnet.nearblocks.io/txns/9MyMJuG8Stcdi6FwwjHRr4Ldw7TUeyqmGbKfdwUKJnQR) |
| The claim | Triggered by anyone, for `g5`. The MPC network signs from the ossuary to the **buyer's** Solana key: buyer $PHOENIX 0 → **540,000**; seller unchanged | [NEAR tx](https://testnet.nearblocks.io/txns/5HyymoFy6YfJfShJmeY6QQiuTFeD6GQLEwAPrpw83TkL) · [Solana tx](https://solscan.io/tx/2DR1BZbr3CfTCNqmptenwtKrNkg3EwvBM1n19qsz41vpQ1W3mWy8GBDaZWhGkWxS9biVuHYKifnTQ8Xjiqe9cLk2?cluster=devnet) |
| Afterwards | A second claim is refused (`already claimed`). The buyer exhumes 5 BONES with a signature; a replay of that signature is refused (`stale or reused signature nonce`) | [twice](https://testnet.nearblocks.io/txns/BV42wcV9uui3cqRGZigKL9La6Rquk38TeywhC2Vucq32) · [exhume](https://testnet.nearblocks.io/txns/EpNxN1aU9qBnqAT781QHKV5hYPbR3HW4QWnpB7Gjp155) · [replay](https://testnet.nearblocks.io/txns/2LggALyEdrT9eAzM2jak1WAQKRcLafLCVrFMaVTPvwzx) |

Grave 5's on-chain history now reads: buried → BONES minted → changed hands → earned 540,000 $PHOENIX (paid to the buyer) → 5 BONES exhumed. See [`/grave/5`](https://necropolis-wine.vercel.app/grave/5).

## Status

- ✅ Contract deployed to NEAR testnet; MPC derivation and verification proven against live attestations.
- ✅ Full burial → rite → MPC-signed payout completed on Solana devnet (above).
- ✅ Ossuary shares proven live: a dead grave was paid from another coin's rising, signed by the ossuary's MPC key (above).
- ✅ Wallet-signed owner actions (epitaph, payout address, transfer) from the grave page's **Keeper's ledger**, with forgery and replay refused.
- ✅ **$BONES (NEP-141):** minted at burial, burned at rising, split by balance at each rising, transferable by signature or `ft_transfer`. Proven live end to end (above); claimable from **My graves**.
- ✅ **NEAR MPC as the coroner:** a plot rose on liquidity and market cap the contract computed from Solana accounts the MPC network read: a real Raydium devnet pool, revived with real trades (above).
- ✅ **Wallet obituaries:** after a scan, `/obituary/<chain>/<address>` turns the result into a share card, with one headstone per dead coin and a glowing one for each coin whose plot rose.
- ✅ **Demo video:** `cd web && npx tsx scripts/record-demo.ts` records a captioned ten-scene walkthrough of production with Playwright (`web/demo/necropolis-demo.webm`). With `FFMPEG=<path>` it also writes an X-ready MP4, with the warm-up trimmed. Every scene reads real chain state. The launch thread is in [`docs/launch/x-thread.md`](docs/launch/x-thread.md).
- ✅ **Candles and boards:** any Solana or EVM wallet can light one candle per grave by signing a message (no fee, relayed). The contract verifies the signature and keeps the count. The cemetery shows **Most mourned** and **Biggest graves** boards. A forged candle and a second candle from the same wallet are both refused ([first candle](https://testnet.nearblocks.io/txns/GPDLUnHwyizLC1SLzBa32XR33WBqmxWxTrUkovq1FDir)).
- ✅ App: landing, cemetery, scanner, autopsy, register, burial flow, grave pages with séance/raise/claims, how-it-works, proof, share cards, PWA (manifest, icons, offline shell).
- ✅ **Try it with no wallet:** on testnet, a one-click throwaway Solana devnet wallet (kept in the browser, key exportable to Phantom) runs the whole flow: test bags, burial, grave, keeper actions, candles, crypt.
- ✅ **NEAR wallets, optional:** HOT, Intear or MyNearWallet. A named NEAR account can hold graves and $BONES, act as a grave's keeper with its own transactions, send BONES with `ft_transfer`, claim shares to an address it names, light candles, and open its crypt with a NEP-413 signature. Burying still happens from the Solana or Base wallet that holds the bag.
- ✅ **My graves** shows the BONES inside every grave you hold and what each is owed, with **Claim all**.
- ✅ **Graves are accounts:** every grave controls a keyless `gN.necropolis.testnet`; $BONES mint into it; claims for it pay the current holder; holder-only crypt; per-grave history. A sale in the middle of a payout ran live with every seller attack refused (above).
- ✅ **Judge desk:** `/verify` and `npm run verify`, 10/10 live claims re-checked from public RPCs, plus the refused attacks with their transactions.
- ✅ **$BONES in the open:** `/bones` with `get_bones_rules` (no setters) and `get_bones_log` (every mint and burn).
- ✅ Tests: 58 contract (incl. three live MPC vectors, the $BONES economics and the sale-mid-payout cases), 36 unit, 9 Playwright smoke (desktop + mobile); `npm run lint` clean.
- ⏳ Base Sepolia end-to-end run: waiting on Sepolia ETH for the Sexton (the code path is built and typechecked).
- ✅ Hosted at https://necropolis-wine.vercel.app (Vercel). A second real burial ran against production: Grave Nº 000001 ($COPIUM) minted 20.7 s after signing ([NEAR tx](https://testnet.nearblocks.io/txns/8XY71n79EGuB3XkkdsNK19ijaE7X1DFc6aw4jCoPUv3s)). Grave NFTs resolve their live art via `base_uri` → `/api/grave/<id>/image.svg`.
- Mainnet is intentionally closed until the contract is audited.

## License

MIT, see [LICENSE](LICENSE).
