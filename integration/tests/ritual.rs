//! The full ritual in a local NEAR sandbox: the compiled Necropolis contract,
//! real accounts, real gas, real cross-contract promises and callbacks, and a
//! stand-in for NEAR's MPC network (`mock-mpc`).
//!
//! Unit tests (`contract/src/tests.rs`) cover the logic. These cover what unit
//! tests can't: the `bury` → `derived_public_key` → `verify_foreign_transaction`
//! → mint promise chain, the keyless grave sub-accounts it creates, the rite
//! across transactions, and payouts signed through the MPC `sign` call.
//!
//! Build the two wasm files first (see `integration/README.md`), then:
//!     cd integration && cargo test -- --test-threads=1

use anyhow::{Result, anyhow};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// ---------------------------------------------------------------- helpers

fn wasm(var: &str, default: &str) -> Result<Vec<u8>> {
    let path = std::env::var(var).unwrap_or_else(|_| default.to_string());
    std::fs::read(&path).map_err(|e| anyhow!("{path}: {e}. Build the wasm first: see integration/README.md"))
}

fn sha256(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

fn b58(b: &[u8]) -> String {
    bs58::encode(b).into_string()
}

fn b58_32(s: &str) -> [u8; 32] {
    bs58::decode(s).into_vec().expect("base58").try_into().expect("32 bytes")
}

/// The key mock-mpc derives for this contract and path in the EdDSA domain (1).
fn derived_ed25519(contract: &AccountId, path: &str) -> [u8; 32] {
    sha256(format!("{}|{}|{}", contract, path, 1).as_bytes())
}

/// An SPL token account (165 bytes): `amount` of `mint`, owned by `owner`, initialised, no delegate.
fn spl_account(mint: &[u8; 32], owner: &[u8; 32], amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint);
    d[32..64].copy_from_slice(owner);
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1;
    d
}

/// sha256(borsh(ForeignTxSignPayload::V1 { Solana request, [AccountState value] })): what the MPC
/// network signs after reading one account at `Finalized`. Same layout as `contract/src/foreign.rs`.
fn solana_payload_hash(tx_sig: &[u8; 64], account: &[u8; 32], data: &[u8]) -> String {
    let mut w = vec![0u8, 2]; // V1, ForeignChainRpcRequest::Solana
    w.extend_from_slice(tx_sig);
    w.push(1); // SvmFinality::Finalized
    w.extend_from_slice(&1u32.to_le_bytes());
    w.push(2); // SvmExtractor::AccountState
    w.extend_from_slice(account);
    w.extend_from_slice(&1u32.to_le_bytes());
    w.push(6); // ExtractedValue::SvmExtractedValue
    w.push(1); // SvmExtractedValue::AccountState
    w.extend_from_slice(&b58_32(TOKEN_PROGRAM));
    w.extend_from_slice(&(data.len() as u32).to_le_bytes());
    w.extend_from_slice(data);
    hex::encode(sha256(&w))
}

fn ok(r: ExecutionFinalResult) -> Result<ExecutionFinalResult> {
    if r.is_failure() {
        return Err(anyhow!("transaction failed: {:?}", r.failures()));
    }
    Ok(r)
}

// ---------------------------------------------------------------- the cemetery

struct Cemetery {
    worker: Worker<Sandbox>,
    root: Account,
    necropolis: Contract,
    mpc: Contract,
    coroner: Account,
    anyone: Account,
}

async fn sub(root: &Account, name: &str, near: u128) -> Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result()?)
}

/// A fresh sandbox: mock MPC, Necropolis initialised for testnet, the Solana
/// devnet ossuary prepared through MPC, and $BONES started.
async fn cemetery() -> Result<Cemetery> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;

    let mpc = sub(&root, "mpc", 10).await?.deploy(&wasm("MOCK_MPC_WASM", "mock-mpc/target/near/mock_mpc.wasm")?).await?.into_result()?;
    ok(mpc.call("new").transact().await?)?;

    let necropolis =
        sub(&root, "necropolis", 50).await?.deploy(&wasm("NECROPOLIS_WASM", "../contract/target/near/necropolis.wasm")?).await?.into_result()?;
    let owner = sub(&root, "owner", 10).await?;
    let coroner = sub(&root, "coroner", 50).await?;
    let anyone = sub(&root, "anyone", 10).await?;
    ok(necropolis
        .call("new")
        .args_json(json!({
            "owner_id": owner.id(),
            "mpc_signer": mpc.id(),
            "network": "testnet",
            "coroners": [coroner.id()],
            "nft_base_uri": null,
        }))
        .transact()
        .await?)?;

    let ossuary = ok(anyone.call(necropolis.id(), "prepare_ossuary").args_json(json!({ "chain": "sol-devnet" })).max_gas().transact().await?)?;
    let expected = b58(&derived_ed25519(necropolis.id(), "ossuary/v1/sol-devnet"));
    assert_eq!(ossuary.json::<Option<String>>()?.as_deref(), Some(expected.as_str()), "ossuary address comes from the MPC-derived key");

    ok(owner.call(necropolis.id(), "bones_genesis").max_gas().transact().await?)?;
    Ok(Cemetery { worker, root, necropolis, mpc, coroner, anyone })
}

/// What the origin chain really holds for a claimed deposit.
#[derive(Clone, Copy)]
enum Chain {
    /// Exactly the claimed deposit.
    Honest,
    /// The transaction never happened.
    Unseen,
    /// The grave's account holds this amount, not the claimed one.
    Holds(u64),
}

struct Burial<'a> {
    origin: [u8; 32],
    mint: [u8; 32],
    nonce: u32,
    amount: u64,
    weight_e6: u64,
    opens_plot: bool,
    chain: Chain,
    tag: &'a str,
}

/// The holder has sent `amount` of `mint` to its grave address on Solana; the
/// coroner registers it. Returns the grave id the contract minted, or None.
async fn bury(c: &Cemetery, b: Burial<'_>) -> Result<Option<u64>> {
    let (origin, mint) = (b58(&b.origin), b58(&b.mint));
    let path = format!("bag/v1/sol-devnet/{}/{}/{}", mint, origin, b.nonce);
    let grave = derived_ed25519(c.necropolis.id(), &path);
    let token_account = sha256(format!("ata|{}", path).as_bytes());
    let mut tx_sig = [0u8; 64];
    tx_sig[..32].copy_from_slice(&sha256(format!("tx|{}|{}", b.tag, path).as_bytes()));
    tx_sig[32..].copy_from_slice(&sha256(format!("tx2|{}|{}", b.tag, path).as_bytes()));
    let claimed = spl_account(&b.mint, &grave, b.amount);

    match b.chain {
        Chain::Honest => see(c, &tx_sig, &solana_payload_hash(&tx_sig, &token_account, &claimed)).await?,
        Chain::Holds(real) => see(c, &tx_sig, &solana_payload_hash(&tx_sig, &token_account, &spl_account(&b.mint, &grave, real))).await?,
        Chain::Unseen => {}
    }

    let plot = b.opens_plot.then(|| json!({ "baseline_mcap_usd": "40000", "peak_daily_volume_usd": "900000", "weight_cap_usd_e6": "1000000000" }));
    let r = ok(c
        .coroner
        .call(c.necropolis.id(), "bury")
        .args_json(json!({ "args": {
            "chain": "sol-devnet",
            "token": mint,
            "origin_owner": origin,
            "nonce": b.nonce,
            "deposit": {
                "kind": "solana",
                "tx_signature": b58(&tx_sig),
                "token_account": b58(&token_account),
                "account_program": TOKEN_PROGRAM,
                "account_data_hex": hex::encode(&claimed),
            },
            "appraisal": {
                "symbol": "RUG", "name": "Rugged", "decimals": 6, "image": null,
                "value_usd_e6": b.weight_e6.to_string(), "weight_usd_e6": b.weight_e6.to_string(),
                "death_score": 91, "model_version": "dm-1.0", "plot": plot,
            },
            "epitaph": "gm forever",
        }}))
        .max_gas()
        .transact()
        .await?)?;
    Ok(r.json::<Option<u64>>()?)
}

async fn see(c: &Cemetery, tx_sig: &[u8; 64], payload_hash: &str) -> Result<()> {
    ok(c.anyone.call(c.mpc.id(), "see_transaction").args_json(json!({ "tx_id": hex::encode(tx_sig), "payload_hash": payload_hash })).transact().await?)?;
    Ok(())
}

async fn view(c: &Cemetery, method: &str, args: Value) -> Result<Value> {
    Ok(c.necropolis.view(method).args_json(args).await?.json::<Value>()?)
}

fn grave_account(c: &Cemetery, id: u64) -> AccountId {
    format!("g{}.{}", id, c.necropolis.id()).parse().unwrap()
}

async fn bones_of(c: &Cemetery, who: &AccountId) -> Result<u128> {
    Ok(view(c, "ft_balance_of", json!({ "account_id": who })).await?.as_str().unwrap_or("0").parse()?)
}

fn alive(t: u64) -> Value {
    json!({
        "t": t.to_string(), "price_usd_e18": "1", "market_cap_usd": "2000000", "liquidity_usd": "120000",
        "volume_24h_usd": "400000", "traders_24h": 450, "flagged_share_bps": 500, "sources": 2,
    })
}

/// Four healthy readings over 400 s: the testnet rite (360 s window, 3 readings, gaps ≤ 180 s).
async fn raise_the_dead(c: &Cemetery, mint: &[u8; 32]) -> Result<Vec<String>> {
    let plot = format!("sol-devnet:{}", b58(mint));
    let now = c.worker.view_block().await?.timestamp() / 1_000_000_000;
    let start = now - 1_000;
    let mut kinds = vec![];
    for t in [start, start + 150, start + 300, start + 400] {
        let r = ok(c.coroner.call(c.necropolis.id(), "observe").args_json(json!({ "plot_id": plot, "observation": alive(t) })).max_gas().transact().await?)?;
        kinds.push(r.json::<Value>()?["kind"].as_str().unwrap_or_default().to_string());
    }
    Ok(kinds)
}

fn fee() -> Value {
    json!({ "fee_payer": b58(&sha256(b"fee payer")), "blockhash": b58(&sha256(b"recent blockhash")) })
}

async fn raise(c: &Cemetery, grave_id: u64) -> Result<bool> {
    let r = ok(c.anyone.call(c.necropolis.id(), "raise_grave").args_json(json!({ "grave_id": grave_id, "solana": fee(), "evm": null })).max_gas().transact().await?)?;
    Ok(r.json::<bool>()?)
}

async fn claim_bones(c: &Cemetery, event_id: u32, holder: &AccountId) -> Result<ExecutionFinalResult> {
    Ok(c
        .anyone
        .call(c.necropolis.id(), "claim_bones")
        .args_json(json!({ "event_id": event_id, "holder": holder, "recipient": null, "auth": null, "solana": fee(), "evm": null }))
        .max_gas()
        .transact()
        .await?)
}

/// Two plots: X (grave 0, 10 BONES) will rise; Y (grave 1, 30 BONES) stays dead.
const MINT_X: &str = "mint X";
const MINT_Y: &str = "mint Y";

// ---------------------------------------------------------------- tests

#[tokio::test]
async fn the_full_ritual_bury_rise_raise_and_claim() -> Result<()> {
    let c = cemetery().await?;
    let (a, b) = (sha256(b"holder A"), sha256(b"holder B"));
    let (x, y) = (sha256(MINT_X.as_bytes()), sha256(MINT_Y.as_bytes()));

    // Burials go through the real promise chain: derive the grave key, verify the deposit, mint.
    let g0 = bury(&c, Burial { origin: a, mint: x, nonce: 1, amount: 1_000_000, weight_e6: 10_000_000, opens_plot: true, chain: Chain::Honest, tag: "a" }).await?;
    let g1 = bury(&c, Burial { origin: b, mint: y, nonce: 1, amount: 5_000_000, weight_e6: 30_000_000, opens_plot: true, chain: Chain::Honest, tag: "b" }).await?;
    assert_eq!((g0, g1), (Some(0), Some(1)));

    let grave = view(&c, "get_grave", json!({ "grave_id": 0 })).await?;
    assert_eq!(grave["owner_id"], hex::encode(a), "owned by the depositor's own key, as a NEAR implicit account");
    assert_eq!(grave["grave_address"], b58(&derived_ed25519(c.necropolis.id(), &format!("bag/v1/sol-devnet/{}/{}/1", b58(&x), b58(&a)))));
    assert_eq!(grave["tithe"], "200000", "20% tithe recorded at burial");
    assert_eq!(c.mpc.view("stats").await?.json::<(u32, u32)>()?.0, 2, "each burial was verified by the MPC network");

    // Each grave controls a real NEAR sub-account with no keys, holding its $BONES.
    for (id, bones) in [(0u64, 10_000_000u128), (1, 30_000_000)] {
        let acct = grave_account(&c, id);
        c.worker.view_account(&acct).await?;
        assert!(c.worker.view_access_keys(&acct).await?.is_empty(), "{acct} has no access keys");
        assert_eq!(bones_of(&c, &acct).await?, bones, "{acct} holds its BONES");
    }

    // The rite: plot X stirs, then rises on the fourth reading.
    let kinds = raise_the_dead(&c, &x).await?;
    assert_eq!(kinds, ["STIRRING", "STIRRING", "STIRRING", "RISEN"]);
    let events = view(&c, "get_events", json!({})).await?;
    assert_eq!(events[0]["pool_amount"], "180000", "20% tithe less a tenth for upkeep");
    assert_eq!(bones_of(&c, &grave_account(&c, 0)).await?, 0, "the risen plot's BONES burn");

    // Too early: no claim until the risen grave is raised and the tithe is in the ossuary.
    assert!(claim_bones(&c, 0, &grave_account(&c, 1)).await?.is_failure());

    // Raise: the contract builds the Solana payout and the MPC network signs it.
    assert!(raise(&c, 0).await?);
    let payout = view(&c, "get_payout", json!({ "key": "raise:0" })).await?;
    assert_eq!(payout["amounts"], json!(["800000", "200000"]), "80% back to the owner, 20% to the ossuary");
    assert_eq!(payout["recipient"], b58(&a));
    assert_eq!(payout["signatures"].as_array().map(|s| s.len()), Some(1));
    assert_eq!(view(&c, "get_grave", json!({ "grave_id": 0 })).await?["raised"], true);

    // Grave 1 held every BONES at the rising, so its holder takes the whole pool, once.
    let holder = grave_account(&c, 1);
    assert!(ok(claim_bones(&c, 0, &holder).await?)?.json::<bool>()?);
    let share = view(&c, "get_payout", json!({ "key": format!("bones:0:{}", holder) })).await?;
    assert_eq!(share["recipient"], b58(&b), "paid to the holder's own Solana key");
    assert_eq!(share["amounts"], json!(["180000"]));
    assert!(claim_bones(&c, 0, &holder).await?.is_failure(), "a share is claimed once");
    assert_eq!(c.mpc.view("stats").await?.json::<(u32, u32)>()?.1, 2, "two payouts signed: the raise and the claim");
    Ok(())
}

#[tokio::test]
async fn a_deposit_the_chain_does_not_hold_mints_nothing() -> Result<()> {
    let c = cemetery().await?;
    let (a, x) = (sha256(b"holder A"), sha256(MINT_X.as_bytes()));
    let graves = |c: &Cemetery| {
        let c = c.necropolis.clone();
        async move { Ok::<_, anyhow::Error>(c.view("get_stats").await?.json::<Value>()?["graves"].as_u64().unwrap_or(0)) }
    };

    // A transaction that never happened.
    let none = bury(&c, Burial { origin: a, mint: x, nonce: 1, amount: 1_000_000, weight_e6: 10_000_000, opens_plot: true, chain: Chain::Unseen, tag: "ghost" }).await?;
    assert_eq!(none, None);
    // A real transaction, but the relayer claims more than the grave's account holds.
    let lie = bury(&c, Burial { origin: a, mint: x, nonce: 2, amount: 1_000_000, weight_e6: 10_000_000, opens_plot: true, chain: Chain::Holds(999), tag: "short" }).await?;
    assert_eq!(lie, None);
    assert_eq!(graves(&c).await?, 0, "no grave without a deposit the MPC network saw");
    assert_eq!(c.mpc.view("stats").await?.json::<(u32, u32)>()?.0, 0);

    // The refused burial left nothing behind: the same grave can be dug once the deposit is real.
    let real = bury(&c, Burial { origin: a, mint: x, nonce: 1, amount: 1_000_000, weight_e6: 10_000_000, opens_plot: true, chain: Chain::Honest, tag: "ghost" }).await?;
    assert_eq!(real, Some(0));
    assert_eq!(graves(&c).await?, 1);
    Ok(())
}

#[tokio::test]
async fn a_sale_in_the_middle_of_a_payout_pays_the_buyer() -> Result<()> {
    let c = cemetery().await?;
    // The seller is a real implicit account: its Solana key is its NEAR key, and the test holds it.
    let seller_key = SecretKey::from_random(KeyType::ED25519);
    let seller_pk = seller_key.public_key().to_string();
    let seller_origin = b58_32(seller_pk.strip_prefix("ed25519:").unwrap());
    let seller_id: AccountId = hex::encode(seller_origin).parse()?;
    ok(c.root.transfer_near(&seller_id, NearToken::from_near(5)).await?)?;
    let seller = Account::from_secret_key(seller_id.clone(), seller_key, &c.worker);
    let buyer = sub(&c.root, "buyer", 10).await?;
    let (a, x, y) = (sha256(b"holder A"), sha256(MINT_X.as_bytes()), sha256(MINT_Y.as_bytes()));

    bury(&c, Burial { origin: a, mint: x, nonce: 1, amount: 1_000_000, weight_e6: 10_000_000, opens_plot: true, chain: Chain::Honest, tag: "a" }).await?;
    let g1 = bury(&c, Burial { origin: seller_origin, mint: y, nonce: 1, amount: 5_000_000, weight_e6: 30_000_000, opens_plot: true, chain: Chain::Honest, tag: "s" }).await?;
    assert_eq!(g1, Some(1));
    assert_eq!(view(&c, "get_grave", json!({ "grave_id": 1 })).await?["owner_id"], seller_id.as_str());

    // X rises and is raised; grave 1 is owed the pool but nobody has claimed it yet.
    raise_the_dead(&c, &x).await?;
    assert!(raise(&c, 0).await?);

    // The seller sells grave 1 (standard NEP-171 transfer, signed with its own key).
    ok(seller
        .call(c.necropolis.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": buyer.id(), "token_id": "1", "approval_id": null, "memo": "sold" }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)?;
    assert_eq!(view(&c, "get_grave", json!({ "grave_id": 1 })).await?["owner_id"], buyer.id().as_str());

    // The buyer names a Solana wallet; anyone triggers the claim; the buyer is paid.
    let buyer_wallet = b58(&sha256(b"buyer's Solana wallet"));
    ok(buyer.call(c.necropolis.id(), "set_payout_address").args_json(json!({ "grave_id": 1, "address": buyer_wallet, "auth": null })).max_gas().transact().await?)?;
    let holder = grave_account(&c, 1);
    assert!(ok(claim_bones(&c, 0, &holder).await?)?.json::<bool>()?);
    let share = view(&c, "get_payout", json!({ "key": format!("bones:0:{}", holder) })).await?;
    assert_eq!(share["recipient"], buyer_wallet, "the buyer is paid, not the seller");

    // The seller has no say any more; the buyer does.
    let seller_tries = |method: &'static str, args: Value| {
        let (seller, id) = (seller.clone(), c.necropolis.id().clone());
        async move { Ok::<_, anyhow::Error>(seller.call(&id, method).args_json(args).max_gas().transact().await?) }
    };
    assert!(seller_tries("exhume_bones", json!({ "grave_id": 1, "amount": "1", "auth": null })).await?.is_failure());
    assert!(seller_tries("set_payout_address", json!({ "grave_id": 1, "address": b58(&seller_origin), "auth": null })).await?.is_failure());
    ok(buyer.call(c.necropolis.id(), "exhume_bones").args_json(json!({ "grave_id": 1, "amount": "5000000", "auth": null })).max_gas().transact().await?)?;
    assert_eq!(bones_of(&c, buyer.id()).await?, 5_000_000);
    assert_eq!(bones_of(&c, &holder).await?, 25_000_000);

    let kinds: Vec<String> = view(&c, "get_grave_history", json!({ "grave_id": 1 }))
        .await?
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|h| h["kind"].as_str().map(String::from))
        .collect();
    assert_eq!(kinds, ["buried", "bones_minted", "transferred", "earned", "bones_exhumed"]);
    Ok(())
}
