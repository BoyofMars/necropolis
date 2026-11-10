//! MPC-read markets: NEAR MPC as the coroner.
//!
//! For a plot bound to a Raydium CPMM pool, the contract reads the market
//! itself instead of trusting a reported number. The NEAR MPC network fetches
//! four Solana accounts in one foreign-chain request: the pool state, its two
//! vaults and the token's mint. The contract parses them and computes:
//!
//! * **liquidity** = 2 × the stablecoin reserve (a constant-product pool holds
//!   equal value on both sides),
//! * **price** = stable reserve / token reserve,
//! * **market cap** = price × the mint's total supply.
//!
//! The coroner still reports volume and trader counts, which aren't account
//! state. Every account key except the pool's comes out of data the AMM program
//! wrote (vaults, mints), and the MPC network reads exactly the keys the
//! contract names. So a coroner can't swap in a different account, and can't
//! replay an old state: MPC reads are live, never older than the anchor
//! transaction's slot.

use crate::foreign::parse_spl_token_account;
use crate::solana;

/// Anchor discriminator of Raydium CPMM `PoolState` = sha256("account:PoolState")[..8].
pub const CPMM_POOL_DISCRIMINATOR: [u8; 8] = [0xf7, 0xed, 0xe3, 0xf5, 0xd7, 0xc3, 0xde, 0x46];
const CPMM_POOL_MIN_LEN: usize = 413;
/// `status` bit that disables swaps in a CPMM pool.
const CPMM_SWAP_DISABLED: u8 = 1 << 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CpmmPool {
    pub vault_a: [u8; 32],
    pub vault_b: [u8; 32],
    pub mint_a: [u8; 32],
    pub mint_b: [u8; 32],
    pub status: u8,
    pub decimals_a: u8,
    pub decimals_b: u8,
    /// protocol + fund + creator fees held in each vault but not part of the reserve
    pub fees_a: u64,
    pub fees_b: u64,
}

fn key_at(d: &[u8], at: usize) -> [u8; 32] {
    let mut k = [0u8; 32];
    k.copy_from_slice(&d[at..at + 32]);
    k
}

fn u64_at(d: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[at..at + 8]);
    u64::from_le_bytes(b)
}

/// Raydium CPMM `PoolState` (offsets from raydium-sdk-v2 `CpmmPoolInfoLayout`).
pub fn parse_cpmm_pool(d: &[u8]) -> Result<CpmmPool, &'static str> {
    if d.len() < CPMM_POOL_MIN_LEN || d[..8] != CPMM_POOL_DISCRIMINATOR {
        return Err("not a Raydium CPMM pool account");
    }
    let sum = |a: u64, b: u64, c: u64| a.checked_add(b).and_then(|x| x.checked_add(c)).ok_or("pool fee counters overflow");
    Ok(CpmmPool {
        vault_a: key_at(d, 72),
        vault_b: key_at(d, 104),
        mint_a: key_at(d, 168),
        mint_b: key_at(d, 200),
        status: d[329],
        decimals_a: d[331],
        decimals_b: d[332],
        fees_a: sum(u64_at(d, 341), u64_at(d, 357), u64_at(d, 397))?,
        fees_b: sum(u64_at(d, 349), u64_at(d, 365), u64_at(d, 405))?,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mint {
    pub supply: u64,
    pub decimals: u8,
}

/// SPL Token / Token-2022 mint base layout (82 bytes).
pub fn parse_mint(d: &[u8]) -> Result<Mint, &'static str> {
    if d.len() < 82 || d[45] != 1 {
        return Err("not an initialised SPL mint");
    }
    Ok(Mint { supply: u64_at(d, 36), decimals: d[44] })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reading {
    pub liquidity_usd: u64,
    pub price_usd_e18: u128,
    pub market_cap_usd: u64,
    pub token_reserve: u64,
    pub quote_reserve: u64,
    pub supply: u64,
}

fn pow10(n: u32) -> Result<u128, &'static str> {
    10u128.checked_pow(n).ok_or("decimals out of range")
}

/// Price a constant-product pool against a $1 stablecoin, in integers.
pub fn compute_reading(token_reserve: u64, token_decimals: u8, quote_reserve: u64, quote_decimals: u8, supply: u64) -> Result<Reading, &'static str> {
    if token_reserve == 0 || quote_reserve == 0 {
        return Err("the pool is empty");
    }
    let q = quote_reserve as u128;
    let t = token_reserve as u128;
    let qd = pow10(quote_decimals as u32)?;
    let liquidity = 2 * q / qd;
    // price (USD per whole token, 1e18) = q/10^qd ÷ t/10^td
    let scale = (18 + token_decimals as u32).checked_sub(quote_decimals as u32).ok_or("decimals out of range")?;
    let price = q.checked_mul(pow10(scale)?).ok_or("reserves too large to price")? / t;
    // market cap = q × supply / t / 10^qd (supply and reserve share the token's decimals)
    let mcap = q.checked_mul(supply as u128).ok_or("supply too large to price")? / t / qd;
    Ok(Reading {
        liquidity_usd: u64::try_from(liquidity).map_err(|_| "liquidity out of range")?,
        price_usd_e18: price,
        market_cap_usd: u64::try_from(mcap).unwrap_or(u64::MAX),
        token_reserve,
        quote_reserve,
        supply,
    })
}

/// Everything the contract needs to send one MPC request and apply its result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prepared {
    /// [pool, token vault, quote vault, token mint]: the keys the MPC network reads
    pub keys: [[u8; 32]; 4],
    pub quote_mint: [u8; 32],
    pub reading: Reading,
}

/// Validate the coroner's copies of the four accounts and compute the reading.
/// `accounts` = (owner program, data) for [pool, token vault, quote vault, token mint].
pub fn prepare(
    token_mint: [u8; 32],
    token_decimals: u8,
    pool_key: [u8; 32],
    accounts: &[([u8; 32], Vec<u8>)],
    amm_programs: &[[u8; 32]],
    stables: &[([u8; 32], u8)],
) -> Result<Prepared, &'static str> {
    let [(pool_owner, pool_data), (tv_owner, tv_data), (qv_owner, qv_data), (mint_owner, mint_data)] = accounts else {
        return Err("expected four accounts: pool, token vault, quote vault, mint");
    };
    if !amm_programs.contains(pool_owner) {
        return Err("pool is not owned by an allowlisted AMM program");
    }
    let pool = parse_cpmm_pool(pool_data)?;
    if pool.status & CPMM_SWAP_DISABLED != 0 {
        return Err("swaps are disabled in this pool");
    }
    let (token_vault, quote_vault, quote_mint, quote_decimals, token_fees, quote_fees, pool_token_decimals) = if pool.mint_a == token_mint {
        (pool.vault_a, pool.vault_b, pool.mint_b, pool.decimals_b, pool.fees_a, pool.fees_b, pool.decimals_a)
    } else if pool.mint_b == token_mint {
        (pool.vault_b, pool.vault_a, pool.mint_a, pool.decimals_a, pool.fees_b, pool.fees_a, pool.decimals_b)
    } else {
        return Err("pool does not trade this token");
    };
    match stables.iter().find(|(m, _)| *m == quote_mint) {
        Some((_, d)) if *d == quote_decimals => {}
        Some(_) => return Err("stablecoin decimals mismatch"),
        None => return Err("the pool's other side is not an allowlisted stablecoin"),
    }
    if pool_token_decimals != token_decimals {
        return Err("pool reports different token decimals");
    }
    let token_programs = [solana::token_program(), solana::token_2022_program()];
    for owner in [tv_owner, qv_owner, mint_owner] {
        if !token_programs.contains(owner) {
            return Err("vault or mint is not an SPL token account");
        }
    }
    let tv = parse_spl_token_account(tv_data)?;
    let qv = parse_spl_token_account(qv_data)?;
    if tv.mint != token_mint || qv.mint != quote_mint {
        return Err("vault holds a different mint than the pool says");
    }
    let mint = parse_mint(mint_data)?;
    if mint.decimals != token_decimals {
        return Err("mint decimals mismatch");
    }
    let token_reserve = tv.amount.checked_sub(token_fees).ok_or("token vault below accrued fees")?;
    let quote_reserve = qv.amount.checked_sub(quote_fees).ok_or("quote vault below accrued fees")?;
    let reading = compute_reading(token_reserve, token_decimals, quote_reserve, quote_decimals, mint.supply)?;
    Ok(Prepared { keys: [pool_key, token_vault, quote_vault, token_mint], quote_mint, reading })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use near_sdk::env;

    pub struct LiveAccount {
        pub key: [u8; 32],
        pub owner: [u8; 32],
        pub data: Vec<u8>,
    }
    pub struct LiveMarket {
        pub anchor: [u8; 64],
        pub accounts: Vec<LiveAccount>,
    }

    fn h(s: &str) -> Vec<u8> {
        hex::decode(s).unwrap()
    }
    fn h32(s: &str) -> [u8; 32] {
        h(s).try_into().unwrap()
    }

    /// The $NGMI/tUSDC CPMM pool on Solana devnet as the MPC network read it on
    /// 2026-11-10: [pool 9qdP4ijx…, NGMI vault FayW2tRE…, tUSDC vault 7hfxvLzH…, NGMI mint].
    pub fn live_market() -> LiveMarket {
        let token_program = "06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9";
        let mut pool = h("f7ede3f5d7c3de4640ccefb95c1e29767b6e03168559a0b8f829d878b619470933ee8a4a48763c8c30f45e15d478e55e77721685787fcefaa16a8741f21ede5ed0c0f8a02a8f0d0cd8b7ab4743e1db2070526f993652dcd75e597aa726d51095d38fb941ffd406036391692aa873bf39e8b9edecc954ecad6e02cb7847b91d0a987455f56594145bb2affa287b9ad6338fecba705b569cb6cca53b9f6992a30d6bd04f463bed3ef808bff674cfa2d70f45e6546cd398d046ebf0644850ee3b623bad0f569119b29427e6ba2c51def00fc415ad3fe473816e3944d9e2d5bcb2a2fcc2a8d2280ca33906ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a906ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a911e70b378753f0fd10fd0c58a28c385e703a18b6f4032f7ddf0c19994784390cff00090606ae7264b55800000000000000000000000000000000000000000000000000000000000000000000006c25f36a00000000b504");
        pool.resize(637, 0); // the remainder of the account is zero padding
        LiveMarket {
            anchor: h("8413cb7e500b2123ca7e478b8ec8059eaa82ba6f8e91745152a8b512c6cb09ec8062aa1ce8244a1b745031502987a21d2d89aa324005b6c27e6180b007dee80a").try_into().unwrap(),
            accounts: vec![
                LiveAccount {
                    key: h32("8352827c9e269a87bf057efd5bb97ab40228420b05f1102ad28f762defd035f5"),
                    owner: h32("b89899792dca5234796fe77462b031df463f5ffeae367c5c0ffb246e1cb7ce0c"),
                    data: pool,
                },
                LiveAccount {
                    key: h32("d8b7ab4743e1db2070526f993652dcd75e597aa726d51095d38fb941ffd40603"),
                    owner: h32(token_program),
                    data: h("08bff674cfa2d70f45e6546cd398d046ebf0644850ee3b623bad0f569119b294ab53ab772724caf0b6a150d55ce2c8cf302e51a1aeafcac5428c9a7433d9f72a002e2afd13b80100000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
                },
                LiveAccount {
                    key: h32("6391692aa873bf39e8b9edecc954ecad6e02cb7847b91d0a987455f56594145b"),
                    owner: h32(token_program),
                    data: h("27e6ba2c51def00fc415ad3fe473816e3944d9e2d5bcb2a2fcc2a8d2280ca339ab53ab772724caf0b6a150d55ce2c8cf302e51a1aeafcac5428c9a7433d9f72a00a3e11100000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
                },
                LiveAccount {
                    key: h32("08bff674cfa2d70f45e6546cd398d046ebf0644850ee3b623bad0f569119b294"),
                    owner: h32(token_program),
                    data: h("0100000030f45e15d478e55e77721685787fcefaa16a8741f21ede5ed0c0f8a02a8f0d0c002ebf70d60002000601000000000000000000000000000000000000000000000000000000000000000000000000"),
                },
            ],
        }
    }

    fn snapshot(m: &LiveMarket) -> Vec<([u8; 32], Vec<u8>)> {
        m.accounts.iter().map(|a| (a.owner, a.data.clone())).collect()
    }

    const TUSDC: &str = "27e6ba2c51def00fc415ad3fe473816e3944d9e2d5bcb2a2fcc2a8d2280ca339";

    #[test]
    fn discriminator_is_anchor_pool_state() {
        assert_eq!(&env::sha256_array(b"account:PoolState")[..8], &CPMM_POOL_DISCRIMINATOR);
    }

    #[test]
    fn live_pool_reads_as_dead() {
        let m = live_market();
        let p = prepare(m.accounts[3].key, 6, m.accounts[0].key, &snapshot(&m), &[m.accounts[0].owner], &[(h32(TUSDC), 6)]).unwrap();
        assert_eq!(p.keys[1], m.accounts[1].key, "token vault comes from pool data");
        assert_eq!(p.keys[2], m.accounts[2].key, "quote vault comes from pool data");
        let r = p.reading;
        assert_eq!(r.quote_reserve, 300_000_000); // 300 tUSDC
        assert_eq!(r.token_reserve, 483_870_968_000_000); // 483.87M NGMI
        assert_eq!(r.liquidity_usd, 600);
        // 300 / 483,870,968 = $0.00000062 per NGMI, the simulated floor
        assert_eq!(r.price_usd_e18, 619_999_999_669);
        assert_eq!(r.supply, 563_870_968_000_000);
        assert_eq!(r.market_cap_usd, 349); // a dead coin
    }

    #[test]
    fn refuses_foreign_programs_and_tokens() {
        let m = live_market();
        let snap = snapshot(&m);
        let amm = [m.accounts[0].owner];
        let stables = [(h32(TUSDC), 6)];
        // pool owned by some other program
        assert!(prepare(m.accounts[3].key, 6, m.accounts[0].key, &snap, &[[9u8; 32]], &stables).is_err());
        // a pool that doesn't trade the plot's token
        assert_eq!(
            prepare([7u8; 32], 6, m.accounts[0].key, &snap, &amm, &stables).unwrap_err(),
            "pool does not trade this token"
        );
        // the other side isn't an allowlisted stablecoin
        assert_eq!(
            prepare(m.accounts[3].key, 6, m.accounts[0].key, &snap, &amm, &[]).unwrap_err(),
            "the pool's other side is not an allowlisted stablecoin"
        );
        // a vault copy for the wrong mint
        let mut swapped = snap.clone();
        swapped.swap(1, 2);
        assert!(prepare(m.accounts[3].key, 6, m.accounts[0].key, &swapped, &amm, &stables).is_err());
        // swaps disabled
        let mut frozen = snap.clone();
        frozen[0].1[329] |= CPMM_SWAP_DISABLED;
        assert_eq!(prepare(m.accounts[3].key, 6, m.accounts[0].key, &frozen, &amm, &stables).unwrap_err(), "swaps are disabled in this pool");
    }

    #[test]
    fn accrued_fees_are_not_liquidity() {
        let m = live_market();
        let mut snap = snapshot(&m);
        // 100 tUSDC of protocol fees sitting in the tUSDC (mint B) vault
        snap[0].1[349..357].copy_from_slice(&100_000_000u64.to_le_bytes());
        let p = prepare(m.accounts[3].key, 6, m.accounts[0].key, &snap, &[m.accounts[0].owner], &[(h32(TUSDC), 6)]).unwrap();
        assert_eq!(p.reading.quote_reserve, 200_000_000);
        assert_eq!(p.reading.liquidity_usd, 400);
    }

    #[test]
    fn reading_math() {
        // 60,000 USDC against 120M tokens (6 dp each), 1B supply: $0.0005, mcap $500k, liquidity $120k
        let r = compute_reading(120_000_000_000_000, 6, 60_000_000_000, 6, 1_000_000_000_000_000).unwrap();
        assert_eq!(r.liquidity_usd, 120_000);
        assert_eq!(r.price_usd_e18, 500_000_000_000_000);
        assert_eq!(r.market_cap_usd, 500_000);
        // 9-decimal token
        let r = compute_reading(2_000_000_000_000_000, 9, 1_000_000_000, 6, 10_000_000_000_000_000).unwrap();
        assert_eq!(r.price_usd_e18, 500_000_000_000_000);
        assert_eq!(r.market_cap_usd, 5_000);
        assert!(compute_reading(0, 6, 1, 6, 1).is_err());
    }
}
