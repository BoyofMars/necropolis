use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::testing_env;

const SOL_OWNER_A: &str = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL_OWNER_B: &str = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT_DEAD: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT_OTHER: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, ts_secs: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("necropolis.testnet"))
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(ts_secs * 1_000_000_000)
        .attached_deposit(NearToken::from_yoctonear(0));
    testing_env!(b.build());
}

fn contract() -> Contract {
    ctx("owner.testnet", 1_000);
    Contract::new(
        acc("owner.testnet"),
        acc("v1.signer-prod.testnet"),
        Network::Testnet,
        vec![acc("coroner.testnet")],
        Some("https://necropolis.example/api/grave".into()),
    )
}

fn appraisal(weight: u64, opens: bool) -> Appraisal {
    Appraisal {
        symbol: "RUG".into(),
        name: "Rugged".into(),
        decimals: 6,
        image: None,
        value_usd_e6: U64(weight),
        weight_usd_e6: U64(weight),
        death_score: 91,
        model_version: "dm-1.0".into(),
        plot: if opens {
            Some(PlotBaseline {
                baseline_mcap_usd: U64(40_000),
                peak_daily_volume_usd: U64(900_000),
                weight_cap_usd_e6: U64(1_000_000_000),
            })
        } else {
            None
        },
    }
}

fn pending(mint: &str, owner: &str, nonce: u32, amount: u128, weight: u64, opens: bool) -> PendingBurial {
    let path = grave_path(Chain::SolDevnet, mint, owner, nonce);
    PendingBurial {
        args: BuryArgs {
            chain: Chain::SolDevnet,
            token: mint.into(),
            origin_owner: owner.into(),
            nonce,
            deposit: DepositProof::Solana {
                tx_signature: format!("sig{}{}", nonce, owner),
                token_account: SOL_OWNER_B.into(),
                account_program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA".into(),
                account_data_hex: String::new(),
            },
            appraisal: appraisal(weight, opens),
            epitaph: Some("gm forever".into()),
        },
        path: path.clone(),
        deposit_key: format!("dep:{}", path),
        grave_address: Some(SOL_OWNER_B.into()),
        amount: Some(U128(amount)),
        expected_hash: Some("ab".repeat(32)),
        token_program: Some("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA".into()),
    }
}

fn alive(t: u64) -> Observation {
    Observation {
        t: U64(t),
        price_usd_e18: U128(1),
        market_cap_usd: U64(2_000_000),
        liquidity_usd: U64(120_000),
        volume_24h_usd: U64(400_000),
        traders_24h: 450,
        flagged_share_bps: 500,
        sources: 2,
    }
}

#[test]
fn burial_records_tithe_weight_and_ownership() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    let id = c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000_000, 50_000_000, true));
    assert_eq!(id, 0);
    let g = c.get_grave(0).unwrap();
    assert_eq!(g.amount.0, 1_000_000);
    assert_eq!(g.tithe.0, 200_000); // 20%
    assert_eq!(g.weight_usd_e6.0, 50_000_000);
    assert_eq!(g.owner_id.as_str().len(), 64); // ed25519 implicit account
    assert_eq!(c.nft_supply_for_owner(g.owner_id.clone()).0, 1);
    let p = c.get_plot(plot_id(Chain::SolDevnet, MINT_DEAD)).unwrap();
    assert_eq!(p.grave_count, 1);
    assert_eq!(p.total_tithe.0, 200_000);
    assert_eq!(c.total_active_weight, 50_000_000);
    assert!(get_logs().iter().any(|l| l.contains("nft_mint")));
}

#[test]
fn weight_is_clamped_to_plot_cap() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    let mut first = pending(MINT_DEAD, SOL_OWNER_A, 1, 10, 900_000_000, true);
    first.args.appraisal.plot.as_mut().unwrap().weight_cap_usd_e6 = U64(1_000_000_000);
    c.inter(first);
    c.inter(pending(MINT_DEAD, SOL_OWNER_B, 2, 10, 900_000_000, false));
    assert_eq!(c.get_grave(1).unwrap().weight_usd_e6.0, 100_000_000);
    c.inter(pending(MINT_DEAD, SOL_OWNER_B, 3, 10, 900_000_000, false));
    assert_eq!(c.get_grave(2).unwrap().weight_usd_e6.0, 0);
}

#[test]
fn low_death_score_earns_no_weight() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    let mut p = pending(MINT_DEAD, SOL_OWNER_A, 1, 10, 5_000_000, true);
    p.args.appraisal.death_score = 40;
    c.inter(p);
    assert_eq!(c.get_grave(0).unwrap().weight_usd_e6.0, 0);
}

#[test]
fn rising_creates_event_and_shares_go_to_other_plots() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    // Plot X (will rise): two graves
    c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000_000, 10_000_000, true));
    c.inter(pending(MINT_DEAD, SOL_OWNER_B, 2, 3_000_000, 30_000_000, false));
    // Plot Y (keeps resting): two graves with weights 1:3
    c.inter(pending(MINT_OTHER, SOL_OWNER_A, 3, 5, 20_000_000, true));
    c.inter(pending(MINT_OTHER, SOL_OWNER_B, 4, 5, 60_000_000, false));
    assert_eq!(c.total_active_weight, 120_000_000);

    let pid = plot_id(Chain::SolDevnet, MINT_DEAD);
    ctx("coroner.testnet", 10_000);
    c.observe(pid.clone(), alive(10_000));
    ctx("coroner.testnet", 10_150);
    c.observe(pid.clone(), alive(10_150));
    ctx("coroner.testnet", 10_300);
    c.observe(pid.clone(), alive(10_300));
    ctx("coroner.testnet", 10_400);
    let s = c.observe(pid.clone(), alive(10_400));
    assert!(matches!(s, PlotState::Risen { .. }));

    let e = c.get_events().pop().unwrap();
    // tithe = 20% of 4,000,000 = 800,000; upkeep 10% of that
    assert_eq!(e.upkeep_amount.0, 80_000);
    assert_eq!(e.pool_amount.0, 720_000);
    // pool weight excludes the risen plot's own graves
    assert_eq!(e.pool_weight_usd_e6.0, 80_000_000);
    assert_eq!(c.total_active_weight, 80_000_000);

    // Y graves split the pool 1:3
    let y_small = c.get_share(2, e.id).unwrap();
    let y_big = c.get_share(3, e.id).unwrap();
    assert_eq!(y_small.amount.unwrap().0, 180_000);
    assert_eq!(y_big.amount.unwrap().0, 540_000);
    // X graves don't share in their own rising
    let x = c.get_share(0, e.id).unwrap();
    assert!(!x.eligible);
}

#[test]
fn graves_buried_after_a_rising_do_not_share_in_it() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000, 10, true));
    c.inter(pending(MINT_OTHER, SOL_OWNER_A, 2, 1_000, 10, true));
    let pid = plot_id(Chain::SolDevnet, MINT_DEAD);
    for t in [10_000u64, 10_150, 10_300, 10_400] {
        ctx("coroner.testnet", t);
        c.observe(pid.clone(), alive(t));
    }
    ctx("necropolis.testnet", 20_000);
    c.inter(pending(MINT_OTHER, SOL_OWNER_B, 3, 1_000, 10, false));
    let late = c.get_share(2, 0).unwrap();
    assert!(!late.eligible);
    assert_eq!(late.reason.as_deref(), Some("this grave was buried after the rising"));
}

#[test]
fn late_burial_into_a_risen_plot_is_kept_but_unweighted() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000, 10, true));
    let pid = plot_id(Chain::SolDevnet, MINT_DEAD);
    for t in [10_000u64, 10_150, 10_300, 10_400] {
        ctx("coroner.testnet", t);
        c.observe(pid.clone(), alive(t));
    }
    ctx("necropolis.testnet", 11_000);
    let id = c.inter(pending(MINT_DEAD, SOL_OWNER_B, 2, 1_000, 10, false));
    assert_eq!(c.get_grave(id).unwrap().weight_usd_e6.0, 0);
}

#[test]
#[should_panic(expected = "only a coroner can do this")]
fn only_coroners_observe() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000, 10, true));
    ctx("random.testnet", 3_000);
    c.observe(plot_id(Chain::SolDevnet, MINT_DEAD), alive(3_000));
}

#[test]
#[should_panic(expected = "this chain is not supported on this network")]
fn mainnet_chains_rejected_on_testnet() {
    let mut c = contract();
    ctx("coroner.testnet", 2_000);
    let mut p = pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000, 10, true);
    p.args.chain = Chain::Sol;
    c.bury(p.args);
}

#[test]
fn duplicate_grave_paths_are_rejected() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    let p = pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000, 10, true);
    c.inter(p.clone());
    ctx("coroner.testnet", 2_100);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.bury(p.args.clone());
    }));
    assert!(r.is_err());
}

#[test]
fn bury_records_pending_and_blocks_reuse_of_deposit() {
    let mut c = contract();
    ctx("coroner.testnet", 2_000);
    let p = pending(MINT_DEAD, SOL_OWNER_A, 7, 1_000, 10, true);
    c.bury(p.args.clone());
    assert!(c.get_pending(p.path.clone()).is_some());
    // Same deposit tx under a different nonce is refused
    let mut again = p.args.clone();
    again.nonce = 8;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ctx("coroner.testnet", 2_001);
        c.bury(again);
    }));
    assert!(r.is_err());
}

#[test]
fn raise_requires_risen_plot_and_ossuary() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000, 10, true));
    let fee = || SolanaFee { fee_payer: SOL_OWNER_B.into(), blockhash: SOL_OWNER_A.into() };
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ctx("anyone.testnet", 2_100);
        c.raise_grave(0, Some(fee()), None);
    }));
    assert!(r.is_err(), "cannot raise a resting plot");

    let pid = plot_id(Chain::SolDevnet, MINT_DEAD);
    for t in [10_000u64, 10_150, 10_300, 10_400] {
        ctx("coroner.testnet", t);
        c.observe(pid.clone(), alive(t));
    }
    c.ossuaries.insert(Chain::SolDevnet, "11111111111111111111111111111112".into());
    ctx("anyone.testnet", 11_000);
    c.raise_grave(0, Some(fee()), None);
    let p = c.get_payout("raise:0".into()).unwrap();
    assert_eq!(p.amounts[0].0, 800);
    assert_eq!(p.amounts[1].0, 200);
    assert_eq!(p.recipient, SOL_OWNER_A); // implicit owner → own key
    assert_eq!(p.unsigned.len(), 1);
}

#[test]
fn owner_actions_need_a_signature_from_implicit_owners() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000, 10, true));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.set_epitaph(0, "hello".into(), None);
    }));
    assert!(r.is_err());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.set_epitaph(0, "hello".into(), Some(OwnerAuth { nonce: 0, signature: "11".repeat(64) }));
    }));
    assert!(r.is_err());
}

#[test]
fn derived_key_parsing() {
    let sol = address_from_derived_key(Chain::SolDevnet, "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2").unwrap();
    assert_eq!(sol, "6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2");
    assert!(address_from_derived_key(Chain::BaseSepolia, "ed25519:abc").is_err());
}

// ------------------------------------------------------------ MPC-read markets

const NGMI: &str = "bA2zfsHzXQU2QXNg38oBXcybBqHJBmR9KB9FXVoRJVy";
const NGMI_POOL: &str = "9qdP4ijxxWV36CEwzSEP11T7kop2hvYaRQsTezo9PPZn";
const TUSDC: &str = "3gkxUqqFfRtaB1U6Zo5gorDz8Nji9LwpM8GSKvdeErnC";
const DEVNET_CPMM: &str = "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb";

fn market_plot() -> (Contract, String) {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(NGMI, SOL_OWNER_A, 1, 1_000_000, 50_000_000, true));
    ctx("owner.testnet", 2_010);
    c.set_market_config(MarketConfig {
        amm_programs: vec![DEVNET_CPMM.into()],
        stable_mints: vec![StableMint { mint: TUSDC.into(), decimals: 6 }],
    });
    (c, plot_id(Chain::SolDevnet, NGMI))
}

/// The live NGMI pool accounts, as the coroner would submit them.
fn live_accounts() -> (String, Vec<AccountSnapshot>) {
    let m = market::tests::live_market();
    let accounts = m
        .accounts
        .iter()
        .map(|a| AccountSnapshot { owner: solana::to_b58(&a.owner), data: near_sdk::json_types::Base64VecU8(a.data.clone()) })
        .collect();
    (bs58::encode(m.anchor).into_string(), accounts)
}

fn bind(c: &mut Contract, pid: &str) {
    ctx("coroner.testnet", 2_020);
    let (anchor, accounts) = live_accounts();
    let (_, o, binding, reading) = c.prepare_market(pid, alive(2_020), NGMI_POOL.into(), anchor, accounts);
    ctx("necropolis.testnet", 2_030);
    let ok = Ok(json!({ "payload_hash": reading.proof_hash }));
    c.on_market_verified(pid.to_string(), o, binding, reading, ok).unwrap();
}

#[test]
fn mpc_read_market_replaces_reported_numbers_and_binds_the_pool() {
    let (mut c, pid) = market_plot();
    ctx("coroner.testnet", 2_020);
    let (anchor, accounts) = live_accounts();
    // The coroner claims a thriving market (alive(): $120k liquidity, $2M mcap). The pool says otherwise.
    let (args, o, binding, reading) = c.prepare_market(&pid, alive(2_020), NGMI_POOL.into(), anchor, accounts);
    // Same request the MPC network answered live on 2026-11-10.
    assert_eq!(reading.proof_hash, "92235a8baa0949c0cc475add6560370f59b2dcc672ddf74505386416023f68cd");
    assert!(args.contains(&reading.proof_hash));
    assert_eq!(o.liquidity_usd.0, 600);
    assert_eq!(o.market_cap_usd.0, 349);
    assert_eq!(o.volume_24h_usd.0, 400_000, "volume still comes from the coroner");
    assert_eq!(binding.quote_mint, TUSDC);
    assert_eq!(binding.program, DEVNET_CPMM);

    ctx("necropolis.testnet", 2_030);
    // A different answer, or no answer, from the MPC network changes nothing.
    let wrong = Ok(json!({ "payload_hash": "00".repeat(32) }));
    assert!(c.on_market_verified(pid.clone(), o.clone(), binding.clone(), reading.clone(), wrong).is_none());
    assert!(c.on_market_verified(pid.clone(), o.clone(), binding.clone(), reading.clone(), Err(PromiseError::Failed)).is_none());
    assert!(c.get_pool_binding(pid.clone()).is_none());
    assert_eq!(c.get_plot(pid.clone()).unwrap().observations, 0);

    // The matching answer binds the pool, stores the reading and runs the rite on verified numbers.
    let ok = Ok(json!({ "payload_hash": reading.proof_hash }));
    let state = c.on_market_verified(pid.clone(), o, binding, reading, ok).unwrap();
    assert!(matches!(state, PlotState::Resting { .. }), "$600 of liquidity cannot stir a plot");
    assert_eq!(c.get_pool_binding(pid.clone()).unwrap().pool, NGMI_POOL);
    let r = c.get_market_reading(pid.clone()).unwrap();
    assert_eq!((r.liquidity_usd.0, r.market_cap_usd.0), (600, 349));
    assert_eq!(c.get_plot(pid).unwrap().observations, 1);
    assert!(get_logs().iter().any(|l| l.contains("pool_bound")));
}

#[test]
#[should_panic(expected = "use observe_market")]
fn bound_plots_refuse_reported_markets() {
    let (mut c, pid) = market_plot();
    bind(&mut c, &pid);
    ctx("coroner.testnet", 2_100);
    c.observe(pid, alive(2_100));
}

#[test]
#[should_panic(expected = "bound to a different pool")]
fn bound_plots_refuse_other_pools() {
    let (mut c, pid) = market_plot();
    bind(&mut c, &pid);
    ctx("coroner.testnet", 2_100);
    let (anchor, accounts) = live_accounts();
    c.prepare_market(&pid, alive(2_100), SOL_OWNER_B.into(), anchor, accounts);
}

#[test]
#[should_panic(expected = "not an allowlisted stablecoin")]
fn markets_need_an_allowlisted_stablecoin() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(NGMI, SOL_OWNER_A, 1, 1_000_000, 50_000_000, true));
    // testnet default config has no stablecoin
    ctx("coroner.testnet", 2_020);
    let (anchor, accounts) = live_accounts();
    c.prepare_market(&plot_id(Chain::SolDevnet, NGMI), alive(2_020), NGMI_POOL.into(), anchor, accounts);
}

// ----------------------------------------------------------------- candles

/// ed25519 seed [7; 32], signing light_candle for grave 0 (generated with @noble/curves).
const CANDLE_MOURNER: &str = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const CANDLE_SIG: &str = "2rJs4vt5TsrW25BFEQxXp6MXRwtnuYYYXKDPNievExTdxYaLHsxtZo5CmFQ6H17RKzoDCFcCGaAHoYpu2YALLRRj";

fn grave_for_candles() -> Contract {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000, 5_000_000, true));
    c.inter(pending(MINT_OTHER, SOL_OWNER_B, 2, 1_000, 5_000_000, true));
    c
}

#[test]
fn wallet_mourners_light_one_candle_per_grave_through_a_relayer() {
    let mut c = grave_for_candles();
    ctx("sexton.testnet", 2_100); // the relayer pays; the signature is the mourner's
    let n = c.light_candle(0, acc(CANDLE_MOURNER), Some(CANDLE_SIG.into()));
    assert_eq!(n.0, 1);
    assert!(c.has_lit_candle(0, acc(CANDLE_MOURNER)));
    ctx("alice.testnet", 2_200);
    c.light_candle(0, acc("alice.testnet"), None);
    c.light_candle(1, acc("alice.testnet"), None);
    assert_eq!(c.get_candles(vec![0, 1, 9]).iter().map(|x| x.0).collect::<Vec<_>>(), vec![2, 1, 0]);
    assert_eq!(c.get_most_mourned(Some(5)).iter().map(|(id, n)| (*id, n.0)).collect::<Vec<_>>(), vec![(0, 2), (1, 1)]);
    assert_eq!(c.get_candle_total().0, 3);
    assert!(get_logs().iter().any(|l| l.contains("\"candle\"")));
}

#[test]
#[should_panic(expected = "already lit a candle here")]
fn a_mourner_cannot_light_twice() {
    let mut c = grave_for_candles();
    ctx("sexton.testnet", 2_100);
    c.light_candle(0, acc(CANDLE_MOURNER), Some(CANDLE_SIG.into()));
    c.light_candle(0, acc(CANDLE_MOURNER), Some(CANDLE_SIG.into()));
}

#[test]
#[should_panic(expected = "invalid mourner signature")]
fn a_candle_signature_is_bound_to_its_grave() {
    let mut c = grave_for_candles();
    ctx("sexton.testnet", 2_100);
    // the grave-0 signature replayed on grave 1
    c.light_candle(1, acc(CANDLE_MOURNER), Some(CANDLE_SIG.into()));
}

#[test]
#[should_panic(expected = "named mourners light their own candles")]
fn nobody_lights_a_candle_for_a_named_account() {
    let mut c = grave_for_candles();
    ctx("sexton.testnet", 2_100);
    c.light_candle(0, acc("alice.testnet"), None);
}

// ----------------------------------------------------------------- $BONES

/// Solana address of the ed25519 seed [7; 32] (implicit account CANDLE_MOURNER).
const SEED7_ORIGIN: &str = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";
/// Its signature over exhume_bones { grave: 0, amount: 10000000, nonce: 0 }.
const SEED7_EXHUME_SIG: &str = "3vrQs8xvBZuSN4ivbxtYoZ58uRqAQwKym9RXyoXVGinXRgtUGbFUnkMtCzsNa1G3AVTn5CXbzQ76PrJvqKMTSrf8";
/// Its signature over transfer_bones { receiver: alice.testnet, amount: 4000000, nonce: 1 }.
const SEED7_TRANSFER_SIG: &str = "16aiSasY6vUscL1YQifkLz3qJnnT57vfHs64Ag1BHSGJnWm1NFVneTES4JNwcAT1QH81sBA9tySCH7pk5gNf94Q";

fn implicit(origin: &str) -> AccountId {
    auth::implicit_owner(origin, true).unwrap()
}

/// The NEAR account grave `id` controls.
fn gacct(id: u64) -> AccountId {
    accounts::grave_account(&acc("necropolis.testnet"), id)
}

fn ctx_yocto(predecessor: &str, ts_secs: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("necropolis.testnet"))
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(ts_secs * 1_000_000_000)
        .attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
}

fn rise(c: &mut Contract, mint: &str, start: u64) {
    let pid = plot_id(Chain::SolDevnet, mint);
    for t in [start, start + 150, start + 300, start + 400] {
        ctx("coroner.testnet", t);
        c.observe(pid.clone(), alive(t));
    }
}

/// $BONES live from an empty cemetery: A buries in plot X (10 BONES), B in plot Y (30 BONES).
fn bones_cemetery() -> (Contract, AccountId, AccountId) {
    let mut c = contract();
    ctx("owner.testnet", 1_500);
    c.bones_genesis();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000_000, 10_000_000, true));
    c.inter(pending(MINT_OTHER, SOL_OWNER_B, 2, 1_000, 30_000_000, true));
    (c, implicit(SOL_OWNER_A), implicit(SOL_OWNER_B))
}

#[test]
fn genesis_mints_bones_for_resting_weighted_graves_only() {
    let mut c = contract();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(MINT_DEAD, SOL_OWNER_A, 1, 1_000_000, 10_000_000, true));
    c.inter(pending(MINT_OTHER, SOL_OWNER_B, 2, 1_000, 30_000_000, true));
    rise(&mut c, MINT_DEAD, 10_000); // a rising before $BONES
    assert_eq!(c.ft_total_supply().0, 0);
    ctx("owner.testnet", 11_000);
    assert_eq!(c.bones_genesis().0, 30_000_000, "only the grave still resting");
    assert_eq!(c.ft_balance_of(gacct(1)).0, 30_000_000, "minted into the grave's own account");
    assert_eq!(c.ft_balance_of(implicit(SOL_OWNER_B)).0, 0);
    assert_eq!(c.get_bones_genesis(), Some(1));
    assert!(c.get_share(1, 0).unwrap().eligible, "the earlier rising still pays per grave");
    assert_eq!(c.ft_metadata().symbol, "BONES");
    assert_eq!(c.ft_metadata().decimals, 6);
    assert!(get_logs().iter().any(|l| l.contains("\"nep141\"") && l.contains("ft_mint")));
}

#[test]
fn bones_grow_with_deaths_shrink_with_risings_and_pay_holders_at_the_rising() {
    let (mut c, a, _b) = bones_cemetery();
    assert_eq!(c.ft_total_supply().0, 40_000_000);
    assert_eq!((c.ft_balance_of(gacct(0)).0, c.ft_balance_of(gacct(1)).0), (10_000_000, 30_000_000));
    // 10 BONES leave grave 1's account for alice before X rises (as if exhumed and sold)
    ctx("necropolis.testnet", 3_000);
    c.bones_transfer_internal(&gacct(1), &acc("alice.testnet"), 10_000_000, Some("exhumed and sold"));
    rise(&mut c, MINT_DEAD, 10_000);
    // X rose: the BONES inside its grave are burned
    assert_eq!(c.ft_balance_of(gacct(0)).0, 0);
    assert_eq!(c.get_grave_bones(0).unwrap().burned.0, 10_000_000);
    assert_eq!(c.ft_total_supply().0, 30_000_000);
    let e = c.get_events().pop().unwrap();
    assert_eq!(e.pool_weight_usd_e6.0, 30_000_000);
    assert_eq!(e.pool_amount.0, 180_000); // 20% of 1,000,000 less 10% upkeep
    // alice sells after the rising: her claim on it stays hers
    ctx_yocto("alice.testnet", 12_000);
    c.ft_transfer(acc("bob.testnet"), U128(10_000_000), None);
    assert_eq!(c.get_bones_share(e.id, gacct(1)).unwrap().amount.unwrap().0, 120_000);
    assert_eq!(c.get_bones_share(e.id, acc("alice.testnet")).unwrap().amount.unwrap().0, 60_000);
    assert!(!c.get_bones_share(e.id, acc("bob.testnet")).unwrap().eligible);
    assert!(!c.get_bones_share(e.id, a).unwrap().eligible);
    assert!(!c.get_share(1, e.id).unwrap().eligible, "per-grave claims are closed for BONES-era risings");
    // burying after the rising mints BONES but can't skim this pool
    ctx("necropolis.testnet", 13_000);
    c.inter(pending(MINT_OTHER, SOL_OWNER_A, 3, 1_000, 5_000_000, false));
    assert_eq!(c.ft_balance_of(gacct(2)).0, 5_000_000);
    assert_eq!(c.get_bones_share(e.id, gacct(2)).unwrap().reason.as_deref(), Some("held no BONES at the rising"));
}

#[test]
fn claim_bones_pays_the_holders_own_key_once() {
    let (mut c, _a, _b) = bones_cemetery();
    rise(&mut c, MINT_DEAD, 10_000);
    c.ossuaries.insert(Chain::SolDevnet, "11111111111111111111111111111112".into());
    let fee = || SolanaFee { fee_payer: SOL_OWNER_A.into(), blockhash: SOL_OWNER_A.into() };
    let holder = gacct(1); // grave 1's account holds its BONES
    ctx("anyone.testnet", 11_000);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.claim_bones(0, holder.clone(), None, None, Some(fee()), None);
    }));
    assert!(early.is_err(), "no claim before the risen graves are raised: the tithe isn't in the ossuary yet");
    assert!(!c.get_bones_share(0, holder.clone()).unwrap().claimed);
    c.graves.get_mut(0).unwrap().raised = true; // raise_grave's MPC callback sets this
    let _ = c.claim_bones(0, holder.clone(), None, None, Some(fee()), None);
    let p = c.get_payout(format!("bones:0:{}", holder)).unwrap();
    assert_eq!(p.recipient, SOL_OWNER_B, "paid to the grave holder's own Solana key");
    assert_eq!(p.amounts[0].0, 180_000, "the only holder takes the whole pool");
    assert!(c.get_bones_share(0, holder.clone()).unwrap().claimed);
    assert!(c.get_grave_history(1).iter().any(|h| h.kind == "earned" && h.amount == Some(U128(180_000))));
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.claim_bones(0, holder.clone(), None, None, Some(fee()), None);
    }));
    assert!(again.is_err(), "a share is claimed once");
}

/// The NFT brief's hard case: the grave is sold between a rising and its payout.
/// The unclaimed share belongs to the grave's account, so it follows the NFT;
/// the seller can no longer move its BONES or redirect its payouts.
#[test]
fn a_sale_in_the_middle_of_a_payout_pays_the_buyer() {
    let (mut c, _a, b) = bones_cemetery();
    rise(&mut c, MINT_DEAD, 10_000); // grave 1's account held 30 BONES at this rising
    c.graves.get_mut(0).unwrap().raised = true;
    c.ossuaries.insert(Chain::SolDevnet, "11111111111111111111111111111112".into());
    // grave 1 changes hands before anyone claims
    ctx("necropolis.testnet", 11_000);
    c.internal_transfer(1, &b, &acc("buyer.testnet"), Some("sold".into()));
    ctx("buyer.testnet", 11_100);
    c.set_payout_address(1, SOL_OWNER_A.into(), None); // the buyer's Solana wallet
    // anyone can trigger the claim; it pays the grave's holder now
    ctx("anyone.testnet", 11_200);
    let fee = SolanaFee { fee_payer: SOL_OWNER_A.into(), blockhash: SOL_OWNER_A.into() };
    let _ = c.claim_bones(0, gacct(1), None, None, Some(fee), None);
    assert_eq!(c.get_payout(format!("bones:0:{}", gacct(1))).unwrap().recipient, SOL_OWNER_A, "the buyer is paid, not the seller");
    // the seller can't exhume the BONES left inside: only the holder can act for the account
    ctx(b.as_str(), 11_300);
    let seller = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.exhume_bones(1, U128(1), None);
    }));
    assert!(seller.is_err(), "the old owner has no say over the grave's account");
    // the buyer can
    ctx("buyer.testnet", 11_400);
    c.exhume_bones(1, U128(5_000_000), None);
    assert_eq!(c.ft_balance_of(acc("buyer.testnet")).0, 5_000_000);
    assert_eq!(c.ft_balance_of(gacct(1)).0, 25_000_000);
    // the history shows who held it, what it earned and what left it
    let kinds: Vec<String> = c.get_grave_history(1).into_iter().map(|h| h.kind).collect();
    assert_eq!(kinds, ["buried", "bones_minted", "transferred", "earned", "bones_exhumed"]);
}

/// A claim made before the sale was already paid to the seller's key; the
/// buyer can't claim it a second time.
#[test]
fn a_claim_made_before_the_sale_stays_with_the_seller() {
    let (mut c, _a, b) = bones_cemetery();
    rise(&mut c, MINT_DEAD, 10_000);
    c.graves.get_mut(0).unwrap().raised = true;
    c.ossuaries.insert(Chain::SolDevnet, "11111111111111111111111111111112".into());
    let fee = || SolanaFee { fee_payer: SOL_OWNER_A.into(), blockhash: SOL_OWNER_A.into() };
    ctx("anyone.testnet", 11_000);
    let _ = c.claim_bones(0, gacct(1), None, None, Some(fee()), None);
    ctx("necropolis.testnet", 11_100);
    c.internal_transfer(1, &b, &acc("buyer.testnet"), None);
    ctx("anyone.testnet", 11_200);
    let twice = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.claim_bones(0, gacct(1), None, None, Some(fee()), None);
    }));
    assert!(twice.is_err());
    assert_eq!(c.get_payout(format!("bones:0:{}", gacct(1))).unwrap().recipient, SOL_OWNER_B);
}

#[test]
fn grave_accounts_are_recognised_and_nothing_else_is() {
    let me = acc("necropolis.testnet");
    assert_eq!(accounts::grave_id_of(&acc("g42.necropolis.testnet"), &me), Some(42));
    assert_eq!(accounts::grave_id_of(&acc("g0.necropolis.testnet"), &me), Some(0));
    for not in ["g042.necropolis.testnet", "gx.necropolis.testnet", "g1.evil.necropolis.testnet", "g1.necropolis.testnet.evil", "alice.testnet", "g.necropolis.testnet"] {
        assert_eq!(accounts::grave_id_of(&acc(not), &me), None, "{}", not);
    }
}

#[test]
fn bones_rules_are_readable_and_every_mint_and_burn_is_logged() {
    let (mut c, _a, _b) = bones_cemetery();
    let r = c.get_bones_rules();
    assert_eq!((r.tithe_bps, r.upkeep_bps, r.min_death_score, r.decimals), (2_000, 1_000, 60, 6));
    assert!(r.setters.is_empty(), "no method can change the mechanic");
    rise(&mut c, MINT_DEAD, 10_000);
    let log: Vec<(String, u64, u128, u128, AccountId)> = c
        .get_bones_log(None, None)
        .into_iter()
        .map(|e| (e.kind, e.grave_id.0, e.amount.0, e.supply_after.0, e.account))
        .collect();
    assert_eq!(
        log,
        [
            ("mint".to_string(), 0, 10_000_000, 10_000_000, gacct(0)),
            ("mint".to_string(), 1, 30_000_000, 40_000_000, gacct(1)),
            ("burn".to_string(), 0, 10_000_000, 30_000_000, gacct(0)),
        ]
    );
    assert_eq!(c.get_bones_rules().mints_and_burns.0, 3);
    assert_eq!(c.get_bones_log(Some(U64(2)), Some(5)).len(), 1);
}

#[test]
fn wallet_holders_move_bones_with_a_signature() {
    let mut c = contract();
    ctx("owner.testnet", 1_500);
    c.bones_genesis();
    ctx("necropolis.testnet", 2_000);
    c.inter(pending(MINT_DEAD, SEED7_ORIGIN, 1, 1_000, 10_000_000, true));
    let holder = acc(CANDLE_MOURNER);
    assert_eq!(c.ft_balance_of(gacct(0)).0, 10_000_000, "BONES start inside the grave");
    ctx("sexton.testnet", 3_000); // the relayer pays; the signatures are the holder's
    c.exhume_bones(0, U128(10_000_000), Some(OwnerAuth { nonce: 0, signature: SEED7_EXHUME_SIG.into() }));
    assert_eq!(c.ft_balance_of(holder.clone()).0, 10_000_000);
    c.bones_transfer(holder.clone(), acc("alice.testnet"), U128(4_000_000), Some(OwnerAuth { nonce: 1, signature: SEED7_TRANSFER_SIG.into() }));
    assert_eq!(c.ft_balance_of(acc("alice.testnet")).0, 4_000_000);
    assert_eq!(c.ft_balance_of(holder.clone()).0, 6_000_000);
    let replay = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.bones_transfer(holder.clone(), acc("alice.testnet"), U128(4_000_000), Some(OwnerAuth { nonce: 1, signature: SEED7_TRANSFER_SIG.into() }));
    }));
    assert!(replay.is_err(), "a signature moves BONES once");
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn ft_transfer_needs_one_yocto() {
    let (mut c, _a, _b) = bones_cemetery();
    ctx("necropolis.testnet", 2_500);
    c.bones_transfer_internal(&gacct(1), &acc("alice.testnet"), 5, None);
    ctx("alice.testnet", 3_000);
    c.ft_transfer(acc("bob.testnet"), U128(1), None);
}

#[test]
#[should_panic(expected = "not enough BONES")]
fn nobody_spends_bones_they_do_not_have() {
    let (mut c, _a, _b) = bones_cemetery();
    ctx_yocto("alice.testnet", 3_000);
    c.ft_transfer(acc("bob.testnet"), U128(1), None);
}
