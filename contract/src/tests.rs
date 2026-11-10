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
