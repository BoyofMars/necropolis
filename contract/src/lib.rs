//! # Necropolis
//!
//! A cross-chain graveyard for dead memecoins.
//!
//! * **Bury** â€” a holder sends a dead token to a *grave address* on its native
//!   chain (Solana or Base). The address is derived from this contract via NEAR
//!   Chain Signatures, so only this contract can ever sign for it. No bridge.
//! * **Verify** â€” the NEAR MPC network independently reads the deposit on the
//!   origin chain (`verify_foreign_transaction`) and the contract mints a grave
//!   (NEP-171) only if the MPC attestation matches the claimed deposit exactly.
//! * **Rite** â€” coroners report vital signs; the contract decides, from terms
//!   frozen when the plot opened, whether a token stirs, falls back or rises.
//! * **Raise** â€” once risen, the contract builds the payout transaction itself
//!   and has the MPC network sign it: 80% back to the owner, 20% tithe to the
//!   ossuary, which is shared by every other grave in the cemetery.

use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{self, Value, json};
use near_sdk::store::{IterableMap, IterableSet, LookupMap, LookupSet, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, PromiseResult,
    env, near, require,
};

pub mod auth;
pub mod events;
pub mod evm;
pub mod foreign;
pub mod market;
pub mod nft;
pub mod rite;
pub mod solana;
pub mod types;
pub mod views;

use foreign::{EvmFinality, ExtractedValue, ForeignRequest, SvmFinality};
use types::*;

const GAS_DERIVE: Gas = Gas::from_tgas(10);
const GAS_ON_DERIVED: Gas = Gas::from_tgas(170);
const GAS_VERIFY: Gas = Gas::from_tgas(60);
const GAS_ON_VERIFIED: Gas = Gas::from_tgas(50);
const GAS_ON_OSSUARY: Gas = Gas::from_tgas(10);
const GAS_SIGN: Gas = Gas::from_tgas(60);
const GAS_ON_SIGNED: Gas = Gas::from_tgas(25);
const GAS_ON_MARKET: Gas = Gas::from_tgas(60);

// MPC-read markets live in their own storage keys (not in `Contract`), so this
// upgrade needs no state migration.
const MARKET_CONFIG_KEY: &[u8] = b"mkt:cfg";
fn binding_key(plot_id: &str) -> Vec<u8> {
    [b"mkt:bind:".as_slice(), plot_id.as_bytes()].concat()
}
fn reading_key(plot_id: &str) -> Vec<u8> {
    [b"mkt:read:".as_slice(), plot_id.as_bytes()].concat()
}
fn raw_get<T: near_sdk::borsh::BorshDeserialize>(key: &[u8]) -> Option<T> {
    env::storage_read(key).and_then(|b| near_sdk::borsh::from_slice(&b).ok())
}
fn raw_set<T: near_sdk::borsh::BorshSerialize>(key: &[u8], v: &T) {
    env::storage_write(key, &near_sdk::borsh::to_vec(v).unwrap());
}
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const ZERO: NearToken = NearToken::from_yoctonear(0);
const MAX_EPITAPH: usize = 140;

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Coroners,
    Plots,
    Graves,
    GraveByPath,
    Deposits,
    Pending,
    PendingDeposits,
    OwnerGraves,
    PlotGraves,
    Events,
    Claims,
    Payouts,
    Nonces,
    Ossuaries,
    OssuaryNonces,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner_id: AccountId,
    pub mpc_signer: AccountId,
    pub network: Network,
    pub terms: Terms,
    /// share of each grave that goes to the ossuary when its plot rises
    pub tithe_bps: u16,
    /// share of the tithe kept for upkeep (protocol)
    pub upkeep_bps: u16,
    /// minimum death score for a grave to earn ossuary weight
    pub min_death_score: u8,
    pub domain_ecdsa: u64,
    pub domain_eddsa: u64,
    pub domain_foreign: u64,
    pub max_evm_gas_limit: U64,
    pub max_evm_fee_per_gas: U128,
    pub nft_base_uri: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub(crate) config: Config,
    pub(crate) coroners: IterableSet<AccountId>,
    pub(crate) plots: IterableMap<String, Plot>,
    pub(crate) graves: Vector<Grave>,
    pub(crate) grave_by_path: LookupMap<String, u64>,
    pub(crate) deposits: LookupMap<String, u64>,
    pub(crate) pending: LookupMap<String, PendingBurial>,
    pub(crate) pending_deposits: LookupSet<String>,
    pub(crate) owner_graves: LookupMap<AccountId, Vec<u64>>,
    pub(crate) plot_graves: LookupMap<String, Vec<u64>>,
    pub(crate) events: Vector<ResurrectionEvent>,
    pub(crate) claims: LookupMap<String, U128>,
    pub(crate) payouts: LookupMap<String, SignedPayout>,
    pub(crate) nonces: LookupMap<AccountId, u64>,
    pub(crate) ossuaries: LookupMap<Chain, String>,
    pub(crate) ossuary_nonces: LookupMap<Chain, u64>,
    pub(crate) total_active_weight: u128,
    pub(crate) total_value_buried_e6: u128,
}

pub(crate) fn now_secs() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn fail(msg: &str) -> ! {
    env::panic_str(msg)
}

pub fn plot_id(chain: Chain, token: &str) -> String {
    format!("{}:{}", chain.key(), token)
}

pub fn grave_path(chain: Chain, token: &str, origin_owner: &str, nonce: u32) -> String {
    format!("bag/v1/{}/{}/{}/{}", chain.key(), token, origin_owner, nonce)
}

pub fn ossuary_path(chain: Chain) -> String {
    format!("ossuary/v1/{}", chain.key())
}

/// Canonical token / owner encodings: base58 for Solana, lowercase 0x for EVM.
pub fn canonical_address(chain: Chain, s: &str) -> Result<String, &'static str> {
    if chain.is_solana() {
        let k = solana::b58(s)?;
        Ok(solana::to_b58(&k))
    } else {
        Ok(evm::address_hex(&evm::parse_address(s)?))
    }
}

/// Parse an MPC `derived_public_key` response into a chain address.
pub fn address_from_derived_key(chain: Chain, key: &str) -> Result<String, &'static str> {
    if chain.is_solana() {
        let b = key.strip_prefix("ed25519:").ok_or("expected an ed25519 key")?;
        let k = solana::b58(b)?;
        Ok(solana::to_b58(&k))
    } else {
        let b = key.strip_prefix("secp256k1:").ok_or("expected a secp256k1 key")?;
        let v = bs58::decode(b).into_vec().map_err(|_| "invalid base58 key")?;
        let xy: &[u8] = match v.len() {
            64 => &v,
            65 if v[0] == 0x04 => &v[1..],
            _ => return Err("unexpected secp256k1 key length"),
        };
        Ok(evm::address_hex(&evm::address_from_pubkey(xy)))
    }
}

/// Where a payout on `chain` goes by default: the owner's payout address if it
/// is on the grave's own chain family, else the owner's own key on that chain
/// (implicit owners), else nothing (the owner must choose a recipient).
pub fn default_recipient(g: &Grave, chain: Chain) -> Option<String> {
    if chain.is_solana() == g.chain.is_solana() {
        if let Some(p) = &g.payout_to {
            return Some(p.clone());
        }
    }
    match auth::owner_kind(&g.owner_id) {
        auth::OwnerKind::Ed25519(k) if chain.is_solana() => Some(solana::to_b58(&k)),
        auth::OwnerKind::Evm(a) if !chain.is_solana() => Some(evm::address_hex(&a)),
        _ => None,
    }
}

fn hex32(s: &str) -> Result<[u8; 32], &'static str> {
    let v = hex::decode(s.trim_start_matches("0x").to_ascii_lowercase()).map_err(|_| "invalid hex")?;
    v.try_into().map_err(|_| "expected 32 bytes")
}

pub(crate) fn evm_log_from_arg(a: &EvmLogArg) -> Result<foreign::EvmLog, &'static str> {
    let mut topics = Vec::with_capacity(a.topics.len());
    for t in &a.topics {
        topics.push(hex32(t)?);
    }
    Ok(foreign::EvmLog {
        removed: a.removed,
        log_index: a.log_index.0,
        transaction_index: a.transaction_index.0,
        transaction_hash: hex32(&a.transaction_hash)?,
        block_hash: hex32(&a.block_hash)?,
        block_number: a.block_number.0,
        address: evm::parse_address(&a.address)?,
        data: a.data.clone(),
        topics,
    })
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        mpc_signer: AccountId,
        network: Network,
        coroners: Vec<AccountId>,
        nft_base_uri: Option<String>,
    ) -> Self {
        let terms = match network {
            Network::Testnet => Terms::testnet(),
            Network::Mainnet => Terms::mainnet(),
        };
        let mut c = Self {
            config: Config {
                owner_id,
                mpc_signer,
                network,
                terms,
                tithe_bps: 2_000,
                upkeep_bps: 1_000,
                min_death_score: 60,
                domain_ecdsa: 0,
                domain_eddsa: 1,
                domain_foreign: 3,
                max_evm_gas_limit: U64(200_000),
                max_evm_fee_per_gas: U128(100_000_000_000),
                nft_base_uri,
            },
            coroners: IterableSet::new(Key::Coroners),
            plots: IterableMap::new(Key::Plots),
            graves: Vector::new(Key::Graves),
            grave_by_path: LookupMap::new(Key::GraveByPath),
            deposits: LookupMap::new(Key::Deposits),
            pending: LookupMap::new(Key::Pending),
            pending_deposits: LookupSet::new(Key::PendingDeposits),
            owner_graves: LookupMap::new(Key::OwnerGraves),
            plot_graves: LookupMap::new(Key::PlotGraves),
            events: Vector::new(Key::Events),
            claims: LookupMap::new(Key::Claims),
            payouts: LookupMap::new(Key::Payouts),
            nonces: LookupMap::new(Key::Nonces),
            ossuaries: LookupMap::new(Key::Ossuaries),
            ossuary_nonces: LookupMap::new(Key::OssuaryNonces),
            total_active_weight: 0,
            total_value_buried_e6: 0,
        };
        for a in coroners {
            c.coroners.insert(a);
        }
        c
    }

    // ------------------------------------------------------------------ admin

    pub fn add_coroner(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.coroners.insert(account_id);
    }

    pub fn remove_coroner(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.coroners.remove(&account_id);
    }

    pub fn set_nft_base_uri(&mut self, base_uri: Option<String>) {
        self.assert_owner();
        self.config.nft_base_uri = base_uri;
    }

    /// Derive and store the ossuary address for a chain. Permissionless and
    /// idempotent: the address is a pure function of (contract, path).
    pub fn prepare_ossuary(&mut self, chain: Chain) -> Promise {
        self.assert_chain(chain);
        let domain = self.domain_for(chain);
        let args = json!({
            "path": ossuary_path(chain),
            "predecessor": env::current_account_id(),
            "domain_id": domain,
        });
        Promise::new(self.config.mpc_signer.clone())
            .function_call("derived_public_key", args.to_string().into_bytes(), ZERO, GAS_DERIVE)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_OSSUARY).on_ossuary(chain))
    }

    #[private]
    pub fn on_ossuary(&mut self, chain: Chain, #[callback_result] key: Result<String, PromiseError>) -> Option<String> {
        let key = key.ok()?;
        let addr = address_from_derived_key(chain, &key).ok()?;
        self.ossuaries.insert(chain, addr.clone());
        events::emit("ossuary_ready", json!({ "chain": chain, "address": addr }));
        Some(addr)
    }

    // ----------------------------------------------------------------- burial

    /// Register a burial. Called by a coroner (who appraises the grave) after
    /// the holder has sent tokens to the grave address. The deposit itself is
    /// verified by the NEAR MPC network before any grave is minted.
    pub fn bury(&mut self, args: BuryArgs) -> Promise {
        self.assert_coroner();
        self.assert_chain(args.chain);
        let chain = args.chain;
        let token = canonical_address(chain, &args.token).unwrap_or_else(|e| fail(e));
        let origin = canonical_address(chain, &args.origin_owner).unwrap_or_else(|e| fail(e));
        if let Some(e) = &args.epitaph {
            require!(e.chars().count() <= MAX_EPITAPH, "epitaph is too long");
        }
        let path = grave_path(chain, &token, &origin, args.nonce);
        require!(
            !self.grave_by_path.contains_key(&path) && !self.pending.contains_key(&path),
            "this grave address is already registered"
        );
        let deposit_key = match &args.deposit {
            DepositProof::Solana { tx_signature, .. } => format!("{}:{}", chain.key(), tx_signature),
            DepositProof::Evm { log } => {
                format!("{}:{}:{}", chain.key(), log.transaction_hash.to_ascii_lowercase(), log.log_index.0)
            }
        };
        require!(
            !self.deposits.contains_key(&deposit_key) && !self.pending_deposits.contains(&deposit_key),
            "this deposit has already been used for a burial"
        );
        match (&args.deposit, chain.is_solana()) {
            (DepositProof::Solana { .. }, true) | (DepositProof::Evm { .. }, false) => {}
            _ => fail("deposit proof does not match the chain"),
        }
        if !self.plots.contains_key(&plot_id(chain, &token)) {
            require!(args.appraisal.plot.is_some(), "the first burial of a token must include a plot baseline");
        }
        let mut args = args;
        args.token = token;
        args.origin_owner = origin;
        self.pending_deposits.insert(deposit_key.clone());
        self.pending.insert(
            path.clone(),
            PendingBurial {
                args,
                path: path.clone(),
                deposit_key,
                grave_address: None,
                amount: None,
                expected_hash: None,
                token_program: None,
            },
        );
        let domain = self.domain_for(chain);
        let derive = json!({ "path": path, "predecessor": env::current_account_id(), "domain_id": domain });
        Promise::new(self.config.mpc_signer.clone())
            .function_call("derived_public_key", derive.to_string().into_bytes(), ZERO, GAS_DERIVE)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_DERIVED).on_grave_address(path))
    }

    #[private]
    pub fn on_grave_address(
        &mut self,
        path: String,
        #[callback_result] key: Result<String, PromiseError>,
    ) -> PromiseOrValue<Option<u64>> {
        let Some(mut p) = self.pending.get(&path).cloned() else {
            return PromiseOrValue::Value(None);
        };
        let key = match key {
            Ok(k) => k,
            Err(_) => {
                self.abort_pending(&path, "the MPC network did not return the grave address");
                return PromiseOrValue::Value(None);
            }
        };
        match self.prepare_verification(&mut p, &key) {
            Ok((req, expected)) => {
                let args = foreign::verify_args_json(&req, &expected, self.config.domain_foreign);
                self.pending.insert(path.clone(), p);
                PromiseOrValue::Promise(
                    Promise::new(self.config.mpc_signer.clone())
                        .function_call("verify_foreign_transaction", args.into_bytes(), ONE_YOCTO, GAS_VERIFY)
                        .then(
                            Self::ext(env::current_account_id())
                                .with_static_gas(GAS_ON_VERIFIED)
                                .on_deposit_verified(path),
                        ),
                )
            }
            Err(e) => {
                self.abort_pending(&path, e);
                PromiseOrValue::Value(None)
            }
        }
    }

    #[private]
    pub fn on_deposit_verified(
        &mut self,
        path: String,
        #[callback_result] response: Result<Value, PromiseError>,
    ) -> Option<u64> {
        let p = self.pending.get(&path).cloned()?;
        let expected = p.expected_hash.clone().unwrap_or_default();
        let ok = match &response {
            Ok(v) => v
                .get("payload_hash")
                .and_then(|h| h.as_str())
                .map(|h| h.trim_start_matches("0x").eq_ignore_ascii_case(&expected))
                .unwrap_or(false),
            Err(_) => false,
        };
        if !ok {
            self.abort_pending(&path, "the MPC network could not verify this deposit");
            return None;
        }
        self.pending.remove(&path);
        self.pending_deposits.remove(&p.deposit_key);
        Some(self.inter(p))
    }

    // ------------------------------------------------------------------- rite

    /// Report vital signs for a plot. The contract applies the rite.
    pub fn observe(&mut self, plot_id: String, observation: Observation) -> PlotState {
        self.assert_coroner();
        require!(
            raw_get::<PoolBinding>(&binding_key(&plot_id)).is_none(),
            "this plot's market is read by the MPC network: use observe_market"
        );
        self.apply_observation(plot_id, observation)
    }

    /// Report vital signs for a plot whose market the NEAR MPC network reads
    /// from Solana. `accounts` are the coroner's copies of [pool, token vault,
    /// quote vault, token mint]. The contract checks them, computes liquidity,
    /// price and market cap itself, and sends their hash to the MPC network as
    /// the expected answer. The rite runs only if the MPC network independently
    /// read exactly that state. The coroner's own liquidity, price and market
    /// cap are discarded; only its volume and trader counts are used.
    pub fn observe_market(
        &mut self,
        plot_id: String,
        observation: Observation,
        pool: String,
        anchor_tx: String,
        accounts: Vec<AccountSnapshot>,
    ) -> Promise {
        self.assert_coroner();
        let (args, o, binding, reading) = self.prepare_market(&plot_id, observation, pool, anchor_tx, accounts);
        Promise::new(self.config.mpc_signer.clone())
            .function_call("verify_foreign_transaction", args.into_bytes(), ONE_YOCTO, GAS_VERIFY)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_MARKET)
                    .on_market_verified(plot_id, o, binding, reading),
            )
    }

    #[private]
    pub fn on_market_verified(
        &mut self,
        plot_id: String,
        observation: Observation,
        binding: PoolBinding,
        reading: MarketReading,
        #[callback_result] response: Result<Value, PromiseError>,
    ) -> Option<PlotState> {
        let ok = match &response {
            Ok(v) => v
                .get("payload_hash")
                .and_then(|h| h.as_str())
                .map(|h| h.trim_start_matches("0x").eq_ignore_ascii_case(&reading.proof_hash))
                .unwrap_or(false),
            Err(_) => false,
        };
        if !ok {
            events::emit("market_unverified", json!({ "plot_id": plot_id, "pool": binding.pool }));
            return None;
        }
        let key = binding_key(&plot_id);
        match raw_get::<PoolBinding>(&key) {
            None => {
                raw_set(&key, &binding);
                events::emit("pool_bound", json!({ "plot_id": plot_id, "pool": binding.pool, "quote_mint": binding.quote_mint }));
            }
            // a concurrent reading bound a different pool first
            Some(b) if b.pool != binding.pool => return None,
            Some(_) => {}
        }
        raw_set(&reading_key(&plot_id), &reading);
        events::emit(
            "market_verified",
            json!({
                "plot_id": plot_id,
                "liquidity_usd": reading.liquidity_usd,
                "market_cap_usd": reading.market_cap_usd,
                "price_usd_e18": reading.price_usd_e18,
                "proof_hash": reading.proof_hash,
            }),
        );
        let risen = self.plots.get(&plot_id).map(|p| matches!(p.state, PlotState::Risen { .. })).unwrap_or(true);
        if risen {
            return None;
        }
        Some(self.apply_observation(plot_id, observation))
    }

    /// Allowlists for MPC-read markets. Owner only (frozen once the contract is locked).
    pub fn set_market_config(&mut self, config: MarketConfig) {
        self.assert_owner();
        for p in &config.amm_programs {
            solana::b58(p).unwrap_or_else(|e| fail(e));
        }
        for s in &config.stable_mints {
            solana::b58(&s.mint).unwrap_or_else(|e| fail(e));
        }
        raw_set(MARKET_CONFIG_KEY, &config);
    }

    // ------------------------------------------------------------------ raise

    /// Raise a grave whose plot has risen. Permissionless: payouts always go to
    /// the grave's owner (or the payout address the owner set). Returns the MPC
    /// signature request(s); the signed transaction can be broadcast by anyone.
    pub fn raise_grave(&mut self, grave_id: u64, solana: Option<SolanaFee>, evm: Option<EvmGas>) -> Promise {
        let g = self.grave_or_panic(grave_id);
        let plot = self.plots.get(&g.plot_id).cloned().unwrap_or_else(|| fail("plot not found"));
        require!(matches!(plot.state, PlotState::Risen { .. }), "this plot has not risen");
        let ossuary =
            self.ossuaries.get(&g.chain).cloned().unwrap_or_else(|| fail("ossuary not prepared for this chain"));
        let recipient = default_recipient(&g, g.chain)
            .unwrap_or_else(|| fail("the grave's owner must set a payout address on this chain"));
        let owner_amount = g.amount.0 - g.tithe.0;
        let key = format!("raise:{}", grave_id);
        let (unsigned, payloads, domain) = if g.chain.is_solana() {
            let fee = solana.unwrap_or_else(|| fail("solana fee payer and blockhash required"));
            let msg = solana::raise_message(
                solana::b58(&fee.fee_payer).unwrap_or_else(|e| fail(e)),
                solana::b58(&g.grave_address).unwrap(),
                solana::b58(g.token_account.as_deref().unwrap()).unwrap(),
                solana::b58(&g.token).unwrap(),
                solana::b58(g.token_program.as_deref().unwrap()).unwrap(),
                g.decimals,
                solana::b58(&recipient).unwrap_or_else(|e| fail(e)),
                u64::try_from(owner_amount).unwrap(),
                solana::b58(&ossuary).unwrap(),
                u64::try_from(g.tithe.0).unwrap(),
                solana::b58(&fee.blockhash).unwrap_or_else(|e| fail(e)),
            );
            let h = hex::encode(&msg);
            (vec![h.clone()], vec![json!({ "Eddsa": h })], self.config.domain_eddsa)
        } else {
            let gas = self.check_gas(evm);
            let token = evm::parse_address(&g.token).unwrap();
            let to_owner = evm::parse_address(&recipient).unwrap_or_else(|e| fail(e));
            let to_ossuary = evm::parse_address(&ossuary).unwrap();
            let chain_id = g.chain.evm_chain_id().unwrap();
            let mut unsigned = vec![];
            let mut payloads = vec![];
            for (nonce, to, amount) in [(0u64, to_owner, owner_amount), (1u64, to_ossuary, g.tithe.0)] {
                if amount == 0 {
                    continue;
                }
                let tx = evm::Eip1559 {
                    chain_id,
                    nonce,
                    max_priority_fee_per_gas: gas.max_priority_fee_per_gas.0,
                    max_fee_per_gas: gas.max_fee_per_gas.0,
                    gas_limit: gas.gas_limit.0,
                    to: token,
                    value: 0,
                    data: evm::erc20_transfer_data(&to, amount),
                };
                unsigned.push(hex::encode(tx.unsigned()));
                payloads.push(json!({ "Ecdsa": hex::encode(tx.signing_hash()) }));
            }
            (unsigned, payloads, self.config.domain_ecdsa)
        };
        self.payouts.insert(
            key.clone(),
            SignedPayout {
                kind: "raise".into(),
                chain: g.chain,
                unsigned,
                signatures: vec![],
                requested_at: U64(now_secs()),
                signed_at: None,
                recipient: recipient.clone(),
                amounts: vec![U128(owner_amount), g.tithe],
                path: g.path.clone(),
            },
        );
        events::emit("raise_requested", json!({ "grave_id": grave_id, "recipient": recipient }));
        self.request_signatures(&g.path, domain, payloads, key)
    }

    /// Claim a grave's share of a resurrection that happened while it rested.
    /// With no `recipient`, pays the owner's origin address (anyone may trigger).
    /// A custom recipient requires the owner's signature.
    #[allow(clippy::too_many_arguments)]
    pub fn claim_share(
        &mut self,
        grave_id: u64,
        event_id: u32,
        recipient: Option<String>,
        auth: Option<OwnerAuth>,
        solana: Option<SolanaFee>,
        evm: Option<EvmGas>,
    ) -> Promise {
        let g = self.grave_or_panic(grave_id);
        let e = self.events.get(event_id).cloned().unwrap_or_else(|| fail("event not found"));
        let share = self.share_of(&g, &e).unwrap_or_else(|reason| fail(reason));
        require!(share > 0, "this grave's share rounds to zero");
        let claim_key = format!("{}:{}", grave_id, event_id);
        require!(!self.claims.contains_key(&claim_key), "already claimed");
        let recipient = match recipient {
            Some(r) => {
                let r = canonical_address(e.chain, &r).unwrap_or_else(|x| fail(x));
                self.authorize(&g, "claim_share", &[("event", event_id.to_string()), ("recipient", r.clone())], auth);
                r
            }
            None => default_recipient(&g, e.chain)
                .unwrap_or_else(|| fail("a recipient on the risen token's chain is required")),
        };
        self.claims.insert(claim_key.clone(), U128(share));
        let key = format!("share:{}", claim_key);
        self.sign_ossuary_payout(&e, recipient, share, key, solana, evm)
    }

    /// Protocol upkeep from a resurrection (owner only).
    pub fn claim_upkeep(
        &mut self,
        event_id: u32,
        recipient: String,
        solana: Option<SolanaFee>,
        evm: Option<EvmGas>,
    ) -> Promise {
        self.assert_owner();
        let e = self.events.get(event_id).cloned().unwrap_or_else(|| fail("event not found"));
        let claim_key = format!("upkeep:{}", event_id);
        require!(!self.claims.contains_key(&claim_key), "already claimed");
        require!(e.upkeep_amount.0 > 0, "nothing to claim");
        let recipient = canonical_address(e.chain, &recipient).unwrap_or_else(|x| fail(x));
        self.claims.insert(claim_key.clone(), e.upkeep_amount);
        self.sign_ossuary_payout(&e, recipient, e.upkeep_amount.0, claim_key, solana, evm)
    }

    #[private]
    pub fn on_payout_signed(&mut self, key: String, count: u32) -> bool {
        let mut sigs = vec![];
        for i in 0..count as u64 {
            #[allow(deprecated)]
            match env::promise_result(i) {
                PromiseResult::Successful(bytes) => sigs.push(String::from_utf8(bytes).unwrap_or_default()),
                _ => {
                    // Signing failed or timed out. Release the claim so it can be retried.
                    if let Some(rest) = key.strip_prefix("share:") {
                        self.claims.remove(&rest.to_string());
                    } else if key.starts_with("upkeep:") {
                        self.claims.remove(&key);
                    }
                    events::emit("payout_signing_failed", json!({ "key": key }));
                    return false;
                }
            }
        }
        if let Some(mut p) = self.payouts.get(&key).cloned() {
            p.signatures = sigs;
            p.signed_at = Some(U64(now_secs()));
            self.payouts.insert(key.clone(), p);
        }
        if let Some(id) = key.strip_prefix("raise:").and_then(|s| s.parse::<u32>().ok()) {
            if let Some(g) = self.graves.get_mut(id) {
                g.raised = true;
            }
        }
        events::emit("payout_signed", json!({ "key": key }));
        true
    }

    // ---------------------------------------------------------- owner actions

    pub fn set_epitaph(&mut self, grave_id: u64, epitaph: String, auth: Option<OwnerAuth>) {
        require!(epitaph.chars().count() <= MAX_EPITAPH, "epitaph is too long");
        let g = self.grave_or_panic(grave_id);
        self.authorize(&g, "set_epitaph", &[("epitaph", epitaph.clone())], auth);
        self.graves.get_mut(grave_id as u32).unwrap().epitaph = Some(epitaph);
    }

    pub fn set_payout_address(&mut self, grave_id: u64, address: String, auth: Option<OwnerAuth>) {
        let g = self.grave_or_panic(grave_id);
        let address = canonical_address(g.chain, &address).unwrap_or_else(|e| fail(e));
        self.authorize(&g, "set_payout_address", &[("address", address.clone())], auth);
        self.graves.get_mut(grave_id as u32).unwrap().payout_to = Some(address);
    }

    /// Transfer a grave (and everything it is owed) to another account, using
    /// a wallet signature. Named NEAR owners can also use `nft_transfer`.
    pub fn transfer_grave(&mut self, grave_id: u64, receiver_id: AccountId, auth: Option<OwnerAuth>) {
        let g = self.grave_or_panic(grave_id);
        self.authorize(&g, "transfer_grave", &[("receiver", receiver_id.to_string())], auth);
        self.internal_transfer(grave_id, &g.owner_id, &receiver_id, None);
    }
}

// ----------------------------------------------------------------- internals

impl Contract {
    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.config.owner_id, "only the owner can do this");
    }

    /// Market allowlists: owner-set, or per-network defaults (Raydium CPMM;
    /// USDC and USDT on mainnet, no stablecoin on testnet until one is set).
    pub(crate) fn market_config(&self) -> MarketConfig {
        raw_get(MARKET_CONFIG_KEY).unwrap_or_else(|| match self.config.network {
            Network::Mainnet => MarketConfig {
                amm_programs: vec!["CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C".into()],
                stable_mints: vec![
                    StableMint { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".into(), decimals: 6 },
                    StableMint { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB".into(), decimals: 6 },
                ],
            },
            Network::Testnet => MarketConfig {
                amm_programs: vec!["DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb".into()],
                stable_mints: vec![],
            },
        })
    }

    /// Check a coroner's account copies for `observe_market` and build
    /// everything the MPC round trip needs: the `verify_foreign_transaction`
    /// args (with the expected hash), the observation with verified numbers,
    /// the pool binding and the reading.
    pub(crate) fn prepare_market(
        &self,
        plot_id: &str,
        observation: Observation,
        pool: String,
        anchor_tx: String,
        accounts: Vec<AccountSnapshot>,
    ) -> (String, Observation, PoolBinding, MarketReading) {
        let plot = self.plots.get(plot_id).cloned().unwrap_or_else(|| fail("plot not found"));
        require!(plot.chain.is_solana(), "MPC-read markets are Solana-only");
        require!(!matches!(plot.state, PlotState::Risen { .. }), "this plot has already risen");
        if let Some(b) = self.pool_binding(plot_id) {
            require!(b.pool == pool, "this plot is bound to a different pool");
        }
        let cfg = self.market_config();
        let decode = |s: &str| solana::b58(s).unwrap_or_else(|e| fail(e));
        let amm: Vec<[u8; 32]> = cfg.amm_programs.iter().map(|p| decode(p)).collect();
        let stables: Vec<([u8; 32], u8)> = cfg.stable_mints.iter().map(|s| (decode(&s.mint), s.decimals)).collect();
        let snaps: Vec<([u8; 32], Vec<u8>)> = accounts.iter().map(|a| (decode(&a.owner), a.data.0.clone())).collect();
        let prepared = market::prepare(decode(&plot.token), plot.decimals, decode(&pool), &snaps, &amm, &stables)
            .unwrap_or_else(|e| fail(e));
        let sig = bs58::decode(&anchor_tx).into_vec().unwrap_or_else(|_| fail("invalid anchor tx"));
        let sig: [u8; 64] = sig.try_into().unwrap_or_else(|_| fail("anchor tx signature must be 64 bytes"));
        let req = ForeignRequest::SolanaAccounts {
            tx_signature: sig,
            accounts: prepared.keys.to_vec(),
            finality: SvmFinality::Finalized,
        };
        let program = snaps[0].0;
        let values: Vec<ExtractedValue> = snaps
            .into_iter()
            .map(|(owner, data)| ExtractedValue::SvmAccount(foreign::SvmAccount { owner, data }))
            .collect();
        let expected = foreign::expected_payload_hash(&req, &values);
        let r = prepared.reading;
        let now = U64(now_secs());
        let binding = PoolBinding {
            pool,
            program: solana::to_b58(&program),
            token_vault: solana::to_b58(&prepared.keys[1]),
            quote_vault: solana::to_b58(&prepared.keys[2]),
            quote_mint: solana::to_b58(&prepared.quote_mint),
            bound_at: now,
        };
        let reading = MarketReading {
            liquidity_usd: U64(r.liquidity_usd),
            price_usd_e18: U128(r.price_usd_e18),
            market_cap_usd: U64(r.market_cap_usd),
            token_reserve: U64(r.token_reserve),
            quote_reserve: U64(r.quote_reserve),
            supply: U64(r.supply),
            anchor_tx,
            proof_hash: hex::encode(expected),
            at: now,
        };
        let mut o = observation;
        o.liquidity_usd = U64(r.liquidity_usd);
        o.price_usd_e18 = U128(r.price_usd_e18);
        o.market_cap_usd = U64(r.market_cap_usd);
        (foreign::verify_args_json(&req, &expected, self.config.domain_foreign), o, binding, reading)
    }

    pub(crate) fn pool_binding(&self, plot_id: &str) -> Option<PoolBinding> {
        raw_get(&binding_key(plot_id))
    }

    pub(crate) fn market_reading(&self, plot_id: &str) -> Option<MarketReading> {
        raw_get(&reading_key(plot_id))
    }

    pub(crate) fn assert_coroner(&self) {
        require!(self.coroners.contains(&env::predecessor_account_id()), "only a coroner can do this");
    }

    fn assert_chain(&self, chain: Chain) {
        let ok = match self.config.network {
            Network::Testnet => chain.is_testnet(),
            Network::Mainnet => !chain.is_testnet(),
        };
        require!(ok, "this chain is not supported on this network");
    }

    fn domain_for(&self, chain: Chain) -> u64 {
        if chain.is_solana() { self.config.domain_eddsa } else { self.config.domain_ecdsa }
    }

    pub(crate) fn grave_or_panic(&self, id: u64) -> Grave {
        require!(id < self.graves.len() as u64, "grave not found");
        self.graves.get(id as u32).cloned().unwrap()
    }

    fn check_gas(&self, gas: Option<EvmGas>) -> EvmGas {
        let gas = gas.unwrap_or_else(|| fail("EVM gas parameters required"));
        require!(gas.gas_limit.0 <= self.config.max_evm_gas_limit.0, "gas limit too high");
        require!(gas.max_fee_per_gas.0 <= self.config.max_evm_fee_per_gas.0, "max fee too high");
        require!(gas.max_priority_fee_per_gas.0 <= gas.max_fee_per_gas.0, "priority fee above max fee");
        gas
    }

    fn abort_pending(&mut self, path: &str, reason: &str) {
        if let Some(p) = self.pending.remove(&path.to_string()) {
            self.pending_deposits.remove(&p.deposit_key);
            events::emit(
                "burial_failed",
                json!({ "path": path, "reason": reason, "deposit": p.deposit_key, "origin_owner": p.args.origin_owner }),
            );
        }
    }

    /// Check the claimed deposit against the derived grave address and build
    /// the MPC verification request + expected payload hash.
    fn prepare_verification(
        &self,
        p: &mut PendingBurial,
        derived_key: &str,
    ) -> Result<(ForeignRequest, [u8; 32]), &'static str> {
        let chain = p.args.chain;
        let grave_address = address_from_derived_key(chain, derived_key)?;
        let (req, value, amount, token_program) = match &p.args.deposit {
            DepositProof::Solana { tx_signature, token_account, account_program, account_data_hex } => {
                let sig = bs58::decode(tx_signature).into_vec().map_err(|_| "invalid tx signature")?;
                let sig: [u8; 64] = sig.try_into().map_err(|_| "tx signature must be 64 bytes")?;
                let account = solana::b58(token_account)?;
                let program = solana::b58(account_program)?;
                require!(
                    program == solana::token_program() || program == solana::token_2022_program(),
                    "grave account is not an SPL token account"
                );
                let data = hex::decode(account_data_hex).map_err(|_| "account data is not hex")?;
                let acc = foreign::parse_spl_token_account(&data)?;
                if acc.mint != solana::b58(&p.args.token)? {
                    return Err("grave account holds a different token");
                }
                if acc.owner != solana::b58(&grave_address)? {
                    return Err("token account is not owned by the grave address");
                }
                if acc.state != 1 {
                    return Err("grave token account is frozen or uninitialised");
                }
                if acc.has_delegate || acc.has_close_authority {
                    return Err("grave token account has a delegate or close authority");
                }
                if acc.amount == 0 {
                    return Err("nothing was buried");
                }
                (
                    ForeignRequest::SolanaAccounts { tx_signature: sig, accounts: vec![account], finality: SvmFinality::Finalized },
                    ExtractedValue::SvmAccount(foreign::SvmAccount { owner: program, data }),
                    acc.amount as u128,
                    Some(account_program.clone()),
                )
            }
            DepositProof::Evm { log } => {
                let l = evm_log_from_arg(log)?;
                let t = foreign::parse_erc20_transfer(&l)?;
                if evm::address_hex(&t.token) != p.args.token {
                    return Err("transfer is for a different token");
                }
                if evm::address_hex(&t.to) != grave_address {
                    return Err("transfer did not go to the grave address");
                }
                if t.amount == 0 {
                    return Err("nothing was buried");
                }
                (
                    ForeignRequest::BaseLog {
                        tx_hash: l.transaction_hash,
                        log_index: l.log_index,
                        finality: EvmFinality::Safe,
                    },
                    ExtractedValue::EvmLog(l),
                    t.amount,
                    None,
                )
            }
        };
        let expected = foreign::expected_payload_hash(&req, std::slice::from_ref(&value));
        p.grave_address = Some(grave_address);
        p.amount = Some(U128(amount));
        p.expected_hash = Some(hex::encode(expected));
        p.token_program = token_program;
        Ok((req, expected))
    }

    /// Mint the grave. Every MPC-verified deposit becomes a grave, even if its
    /// plot is stirring or risen, so buried tokens can never be stranded.
    pub(crate) fn inter(&mut self, p: PendingBurial) -> u64 {
        let a = p.args;
        let chain = a.chain;
        let pid = plot_id(chain, &a.token);
        let now = now_secs();
        if !self.plots.contains_key(&pid) {
            let base = a.appraisal.plot.clone().unwrap_or(PlotBaseline {
                baseline_mcap_usd: U64(0),
                peak_daily_volume_usd: U64(0),
                weight_cap_usd_e6: U64(0),
            });
            self.plots.insert(
                pid.clone(),
                Plot {
                    id: pid.clone(),
                    chain,
                    token: a.token.clone(),
                    symbol: a.appraisal.symbol.clone(),
                    name: a.appraisal.name.clone(),
                    decimals: a.appraisal.decimals,
                    image: a.appraisal.image.clone(),
                    terms: self.config.terms.clone(),
                    baseline_mcap_usd: base.baseline_mcap_usd,
                    peak_daily_volume_usd: base.peak_daily_volume_usd,
                    weight_cap_usd_e6: base.weight_cap_usd_e6,
                    opened_at: U64(now),
                    state: PlotState::Resting { false_dawns: 0, last_observed_at: None },
                    grave_count: 0,
                    total_amount: U128(0),
                    total_tithe: U128(0),
                    total_weight_usd_e6: U64(0),
                    observations: 0,
                    last_observation: None,
                },
            );
            events::emit("plot_opened", json!({ "plot_id": pid, "symbol": a.appraisal.symbol }));
        }
        let mut plot = self.plots.get(&pid).cloned().unwrap();
        let resting = matches!(plot.state, PlotState::Resting { .. });
        let amount = p.amount.unwrap().0;
        let tithe = amount * self.config.tithe_bps as u128 / 10_000;
        let room = plot.weight_cap_usd_e6.0.saturating_sub(plot.total_weight_usd_e6.0);
        let weight = if resting && a.appraisal.death_score >= self.config.min_death_score {
            a.appraisal.weight_usd_e6.0.min(room)
        } else {
            0
        };
        let id = self.graves.len() as u64;
        let owner_id = auth::implicit_owner(&a.origin_owner, chain.is_solana()).unwrap_or_else(|e| fail(e));
        let (deposit_tx, deposit_log_index) = match &a.deposit {
            DepositProof::Solana { tx_signature, .. } => (tx_signature.clone(), None),
            DepositProof::Evm { log } => (log.transaction_hash.to_ascii_lowercase(), Some(log.log_index)),
        };
        let token_account = match &a.deposit {
            DepositProof::Solana { token_account, .. } => Some(token_account.clone()),
            _ => None,
        };
        let grave = Grave {
            id,
            plot_id: pid.clone(),
            chain,
            token: a.token.clone(),
            owner_id: owner_id.clone(),
            origin_owner: a.origin_owner.clone(),
            path: p.path.clone(),
            grave_address: p.grave_address.clone().unwrap(),
            token_account,
            token_program: p.token_program.clone(),
            decimals: a.appraisal.decimals,
            amount: U128(amount),
            tithe: U128(tithe),
            value_usd_e6: a.appraisal.value_usd_e6,
            weight_usd_e6: U64(weight),
            death_score: a.appraisal.death_score,
            epitaph: a.epitaph.clone(),
            buried_at: U64(now),
            deposit_tx,
            deposit_log_index,
            proof_hash: p.expected_hash.clone().unwrap_or_default(),
            payout_to: None,
            raised: false,
        };
        plot.grave_count += 1;
        plot.total_amount = U128(plot.total_amount.0 + amount);
        plot.total_tithe = U128(plot.total_tithe.0 + tithe);
        plot.total_weight_usd_e6 = U64(plot.total_weight_usd_e6.0 + weight);
        self.plots.insert(pid.clone(), plot);
        if resting {
            self.total_active_weight += weight as u128;
        }
        self.total_value_buried_e6 += a.appraisal.value_usd_e6.0 as u128;
        self.graves.push(grave);
        self.grave_by_path.insert(p.path.clone(), id);
        self.deposits.insert(p.deposit_key.clone(), id);
        let mut og = self.owner_graves.get(&owner_id).cloned().unwrap_or_default();
        og.push(id);
        self.owner_graves.insert(owner_id.clone(), og);
        let mut pg = self.plot_graves.get(&pid).cloned().unwrap_or_default();
        pg.push(id);
        self.plot_graves.insert(pid.clone(), pg);
        events::nft_mint(&owner_id, id);
        events::emit(
            "burial",
            json!({
                "grave_id": id,
                "plot_id": pid,
                "owner_id": owner_id,
                "amount": U128(amount),
                "weight_usd_e6": U64(weight),
                "deposit": p.deposit_key,
                "proof_hash": p.expected_hash,
            }),
        );
        id
    }

    pub(crate) fn apply_observation(&mut self, pid: String, o: Observation) -> PlotState {
        let mut plot = self.plots.get(&pid).cloned().unwrap_or_else(|| fail("plot not found"));
        let event_id = self.events.len();
        let (state, tr) = rite::advance(
            &plot.terms,
            plot.baseline_mcap_usd.0,
            plot.peak_daily_volume_usd.0,
            &plot.state,
            &o,
            now_secs(),
            event_id,
        )
        .unwrap_or_else(|e| fail(e));
        plot.state = state.clone();
        plot.observations += 1;
        plot.last_observation = Some(o.clone());
        let transition = format!("{:?}", tr);
        if tr == rite::Transition::Risen {
            let pool_weight = self.total_active_weight.saturating_sub(plot.total_weight_usd_e6.0 as u128);
            let tithe = plot.total_tithe.0;
            let (pool, upkeep) = if pool_weight == 0 {
                (0, tithe)
            } else {
                let upkeep = tithe * self.config.upkeep_bps as u128 / 10_000;
                (tithe - upkeep, upkeep)
            };
            self.total_active_weight = pool_weight;
            let at = match &state {
                PlotState::Risen { at, .. } => *at,
                _ => unreachable!(),
            };
            self.events.push(ResurrectionEvent {
                id: event_id,
                plot_id: pid.clone(),
                chain: plot.chain,
                token: plot.token.clone(),
                at,
                pool_amount: U128(pool),
                upkeep_amount: U128(upkeep),
                pool_weight_usd_e6: U128(pool_weight),
                decimals: plot.decimals,
                symbol: plot.symbol.clone(),
            });
            events::emit(
                "risen",
                json!({ "plot_id": pid, "event_id": event_id, "pool_amount": U128(pool), "pool_weight_usd_e6": U128(pool_weight) }),
            );
        }
        self.plots.insert(pid.clone(), plot);
        events::emit("observation", json!({ "plot_id": pid, "t": o.t, "transition": transition }));
        state
    }

    /// Share of event `e` owed to grave `g`, or why it is not eligible.
    pub(crate) fn share_of(&self, g: &Grave, e: &ResurrectionEvent) -> Result<u128, &'static str> {
        if g.plot_id == e.plot_id {
            return Err("a grave does not share in its own plot's rising");
        }
        if g.buried_at.0 >= e.at.0 {
            return Err("this grave was buried after the rising");
        }
        if g.weight_usd_e6.0 == 0 {
            return Err("this grave carries no ossuary weight");
        }
        if let Some(p) = self.plots.get(&g.plot_id) {
            if let PlotState::Risen { at, .. } = p.state {
                if at.0 <= e.at.0 {
                    return Err("this grave's own plot had already risen");
                }
            }
        }
        if e.pool_weight_usd_e6.0 == 0 {
            return Err("no pool weight");
        }
        Ok(e.pool_amount.0 * g.weight_usd_e6.0 as u128 / e.pool_weight_usd_e6.0)
    }

    fn sign_ossuary_payout(
        &mut self,
        e: &ResurrectionEvent,
        recipient: String,
        amount: u128,
        key: String,
        solana: Option<SolanaFee>,
        evm: Option<EvmGas>,
    ) -> Promise {
        let ossuary = self.ossuaries.get(&e.chain).cloned().unwrap_or_else(|| fail("ossuary not prepared"));
        let path = ossuary_path(e.chain);
        let (unsigned, payloads, domain) = if e.chain.is_solana() {
            let fee = solana.unwrap_or_else(|| fail("solana fee payer and blockhash required"));
            // Token program: taken from any grave of the risen plot (all share the mint).
            let program = self
                .plot_graves
                .get(&e.plot_id)
                .and_then(|ids| ids.first().copied())
                .and_then(|id| self.graves.get(id as u32))
                .and_then(|g| g.token_program.clone())
                .unwrap_or_else(|| fail("unknown token program"));
            let msg = solana::ossuary_payout_message(
                solana::b58(&fee.fee_payer).unwrap_or_else(|x| fail(x)),
                solana::b58(&ossuary).unwrap(),
                solana::b58(&e.token).unwrap(),
                solana::b58(&program).unwrap(),
                e.decimals,
                solana::b58(&recipient).unwrap_or_else(|x| fail(x)),
                u64::try_from(amount).unwrap(),
                solana::b58(&fee.blockhash).unwrap_or_else(|x| fail(x)),
            );
            let h = hex::encode(&msg);
            (vec![h.clone()], vec![json!({ "Eddsa": h })], self.config.domain_eddsa)
        } else {
            let gas = self.check_gas(evm);
            let nonce = self.ossuary_nonces.get(&e.chain).copied().unwrap_or(0);
            self.ossuary_nonces.insert(e.chain, nonce + 1);
            let tx = evm::Eip1559 {
                chain_id: e.chain.evm_chain_id().unwrap(),
                nonce,
                max_priority_fee_per_gas: gas.max_priority_fee_per_gas.0,
                max_fee_per_gas: gas.max_fee_per_gas.0,
                gas_limit: gas.gas_limit.0,
                to: evm::parse_address(&e.token).unwrap(),
                value: 0,
                data: evm::erc20_transfer_data(&evm::parse_address(&recipient).unwrap_or_else(|x| fail(x)), amount),
            };
            (
                vec![hex::encode(tx.unsigned())],
                vec![json!({ "Ecdsa": hex::encode(tx.signing_hash()) })],
                self.config.domain_ecdsa,
            )
        };
        self.payouts.insert(
            key.clone(),
            SignedPayout {
                kind: if key.starts_with("upkeep") { "upkeep".into() } else { "share".into() },
                chain: e.chain,
                unsigned,
                signatures: vec![],
                requested_at: U64(now_secs()),
                signed_at: None,
                recipient,
                amounts: vec![U128(amount)],
                path: path.clone(),
            },
        );
        self.request_signatures(&path, domain, payloads, key)
    }

    fn request_signatures(&self, path: &str, domain: u64, payloads: Vec<Value>, key: String) -> Promise {
        let count = payloads.len() as u32;
        require!(count > 0, "nothing to sign");
        let mut joined: Option<Promise> = None;
        for payload in payloads {
            let args = json!({ "request": { "path": path, "payload_v2": payload, "domain_id": domain } });
            let p = Promise::new(self.config.mpc_signer.clone()).function_call(
                "sign",
                serde_json::to_vec(&args).unwrap(),
                ONE_YOCTO,
                GAS_SIGN,
            );
            joined = Some(match joined {
                None => p,
                Some(j) => j.and(p),
            });
        }
        joined
            .unwrap()
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_SIGNED).on_payout_signed(key, count))
    }

    /// Owner authorisation: named NEAR owners call directly; implicit owners
    /// (Solana / EVM keys) sign the canonical action message with their wallet.
    pub(crate) fn authorize(&mut self, g: &Grave, action: &str, fields: &[(&str, String)], auth: Option<OwnerAuth>) {
        match auth::owner_kind(&g.owner_id) {
            auth::OwnerKind::Named => {
                require!(env::predecessor_account_id() == g.owner_id, "only the grave's owner can do this");
            }
            _ => {
                let a = auth.unwrap_or_else(|| fail("a wallet signature from the grave's owner is required"));
                let expected = self.nonces.get(&g.owner_id).copied().unwrap_or(0);
                require!(a.nonce == expected, "stale or reused signature nonce");
                let msg = auth::action_message(env::current_account_id().as_str(), action, g.id, fields, a.nonce);
                require!(auth::verify_owner_signature(&g.owner_id, &msg, &a.signature), "invalid owner signature");
                self.nonces.insert(g.owner_id.clone(), expected + 1);
            }
        }
    }

    pub(crate) fn internal_transfer(&mut self, grave_id: u64, from: &AccountId, to: &AccountId, memo: Option<String>) {
        require!(from != to, "cannot transfer to the current owner");
        let g = self.graves.get_mut(grave_id as u32).unwrap();
        g.owner_id = to.clone();
        // Payout address must be re-set by the new owner.
        g.payout_to = None;
        let mut a = self.owner_graves.get(from).cloned().unwrap_or_default();
        a.retain(|x| *x != grave_id);
        self.owner_graves.insert(from.clone(), a);
        let mut b = self.owner_graves.get(to).cloned().unwrap_or_default();
        b.push(grave_id);
        self.owner_graves.insert(to.clone(), b);
        events::nft_transfer(from, to, grave_id, memo);
    }
}

#[cfg(test)]
mod tests;
