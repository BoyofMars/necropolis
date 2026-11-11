//! $BONES: the ossuary as a fungible token (NEP-141, with NEP-145/148 views).
//!
//! Supply follows the cemetery:
//!   * **minted** when a dead coin is buried with ossuary weight, into the
//!     grave's own account `g<id>.<contract>` (1 BONES = $1 of weight,
//!     6 decimals), so it grows as coins die and belongs to whoever holds the NFT;
//!   * **burned** when that coin's plot rises, from the grave's account, as far
//!     as it still holds it, so it shrinks as coins come back.
//!
//! Every mint and burn is appended to an on-chain log (`get_bones_log`), and
//! the rules are readable (`get_bones_rules`). None of them has a setter: the
//! tithe, the upkeep, the death-score floor and the mint rate are fixed in code.
//!
//! Each rising's ossuary pool (the tithe less upkeep) is split among BONES
//! holders by their balance **at the moment of the rising**, read from
//! per-account checkpoints. BONES bought after a rising never shares in it, so
//! burying junk after the fact can't skim a payout. Past risings stay with
//! whoever held at the time; future ones follow the token.
//!
//! BONES is transferable. NEAR accounts use `ft_transfer` / `ft_transfer_call`
//! (so it can sit in a DEX). Solana and EVM holders sign a message and the
//! Sexton relays `bones_transfer`, so they never need NEAR.
//!
//! State lives under its own `bns:` storage keys, so adding it needed no
//! migration. Risings before `bones_genesis` keep their per-grave shares.

use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{Value, json};
use near_sdk::{AccountId, Gas, Promise, PromiseError, PromiseOrValue, env, ext_contract, near, require};

use crate::*;

pub const BONES_DECIMALS: u8 = 6;
const GAS_FT_ON_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FT_RESOLVE: Gas = Gas::from_tgas(10);
const GAS_FT_CALL_MIN: Gas = Gas::from_tgas(35);

const SUPPLY_KEY: &[u8] = b"bns:sup";
const GENESIS_KEY: &[u8] = b"bns:genesis";
const LOG_LEN_KEY: &[u8] = b"bns:log#";
fn log_key(i: u64) -> Vec<u8> {
    format!("bns:log:{}", i).into_bytes()
}
fn balance_key(a: &AccountId) -> Vec<u8> {
    format!("bns:bal:{}", a).into_bytes()
}
fn checkpoint_key(a: &AccountId) -> Vec<u8> {
    format!("bns:cp:{}", a).into_bytes()
}
fn grave_key(grave_id: u64) -> Vec<u8> {
    format!("bns:g:{}", grave_id).into_bytes()
}
fn event_supply_key(event_id: u32) -> Vec<u8> {
    format!("bns:ev:{}", event_id).into_bytes()
}
fn claim_key(event_id: u32, holder: &AccountId) -> Vec<u8> {
    format!("bns:cl:{}:{}", event_id, holder).into_bytes()
}
/// Released when MPC signing fails, so the claim can be retried (see `on_payout_signed`).
pub(crate) fn release_bones_claim(payout_key_rest: &str) {
    env::storage_remove(format!("bns:cl:{}", payout_key_rest).as_bytes());
}

/// What a grave minted, and what was burned when its plot rose.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraveBones {
    pub minted_to: AccountId,
    pub amount: U128,
    pub burned: U128,
    pub settled: bool,
}

/// One mint or burn, in order. `supply_after` lets anyone replay the supply.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BonesLogEntry {
    pub i: U64,
    pub at: U64,
    /// mint · burn
    pub kind: String,
    pub account: AccountId,
    pub amount: U128,
    pub supply_after: U128,
    pub grave_id: U64,
    pub note: String,
}

/// The whole mechanic, as the contract runs it. Nothing here has a setter.
#[near(serializers = [json])]
pub struct BonesRules {
    pub symbol: String,
    pub decimals: u8,
    /// BONES minted per $1 of ossuary weight
    pub bones_per_usd_of_weight: U128,
    /// share of every buried bag set aside for the ossuary when its coin rises
    pub tithe_bps: u16,
    /// share of that tithe kept for upkeep; the rest is the holders' pool
    pub upkeep_bps: u16,
    /// a grave earns weight (and so BONES) only above this death score
    pub min_death_score: u8,
    pub genesis_event: Option<u32>,
    pub total_supply: U128,
    pub mints_and_burns: U64,
    pub rules: Vec<String>,
    /// methods that can change any of the above: none
    pub setters: Vec<String>,
}

#[near(serializers = [json])]
pub struct BonesShareView {
    pub event_id: u32,
    pub holder: AccountId,
    pub balance_at_rising: U128,
    pub supply_at_rising: Option<U128>,
    pub amount: Option<U128>,
    pub eligible: bool,
    pub reason: Option<String>,
    pub claimed: bool,
}

#[near(serializers = [json])]
pub struct FungibleTokenMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [json])]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(serializers = [json])]
pub struct StorageBalanceBounds {
    pub min: U128,
    pub max: Option<U128>,
}

#[ext_contract(ext_ft_receiver)]
pub trait FungibleTokenReceiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>;
}

fn ft_event(event: &str, mut data: Value, memo: Option<&str>) {
    if let Some(m) = memo {
        data["memo"] = json!(m);
    }
    let line = json!({ "standard": "nep141", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{}", line));
}

/// floor(a × b / c) without overflowing on large token amounts.
fn mul_div(a: u128, b: u128, c: u128) -> Option<u128> {
    if c == 0 {
        return None;
    }
    (a / c).checked_mul(b)?.checked_add((a % c).checked_mul(b)? / c)
}

/// Where a holder's share goes by default: their own key on the risen chain.
fn account_recipient(holder: &AccountId, chain: Chain) -> Option<String> {
    match auth::owner_kind(holder) {
        auth::OwnerKind::Ed25519(k) if chain.is_solana() => Some(solana::to_b58(&k)),
        auth::OwnerKind::Evm(a) if !chain.is_solana() => Some(evm::address_hex(&a)),
        _ => None,
    }
}

// --------------------------------------------------------------- internals

impl Contract {
    pub(crate) fn bones_genesis_event(&self) -> Option<u32> {
        raw_get(GENESIS_KEY)
    }

    /// Risings from genesis on are paid to BONES holders.
    pub(crate) fn bones_era(&self, event_id: u32) -> bool {
        self.bones_genesis_event().is_some_and(|g| event_id >= g)
    }

    pub(crate) fn bones_balance(&self, a: &AccountId) -> u128 {
        raw_get(&balance_key(a)).unwrap_or(0)
    }

    pub(crate) fn bones_supply(&self) -> u128 {
        raw_get(SUPPLY_KEY).unwrap_or(0)
    }

    /// Set a balance and checkpoint it against the number of risings so far.
    /// A checkpoint `(k, v)` means "v from just before rising k was recorded".
    fn set_bones_balance(&mut self, a: &AccountId, v: u128) {
        raw_set(&balance_key(a), &v);
        let k = self.events.len();
        let mut cps: Vec<(u32, u128)> = raw_get(&checkpoint_key(a)).unwrap_or_default();
        match cps.last_mut() {
            Some(last) if last.0 == k => last.1 = v,
            _ => cps.push((k, v)),
        }
        raw_set(&checkpoint_key(a), &cps);
    }

    /// Balance an account held at the moment rising `event_id` happened.
    pub(crate) fn bones_balance_at(&self, a: &AccountId, event_id: u32) -> u128 {
        let cps: Vec<(u32, u128)> = raw_get(&checkpoint_key(a)).unwrap_or_default();
        cps.iter().rev().find(|(k, _)| *k <= event_id).map(|(_, v)| *v).unwrap_or(0)
    }

    pub(crate) fn bones_log_len(&self) -> u64 {
        raw_get(LOG_LEN_KEY).unwrap_or(0)
    }

    pub(crate) fn bones_log(&mut self, at: u64, kind: &str, account: &AccountId, amount: u128, grave_id: u64, note: String) {
        let i = self.bones_log_len();
        let e = BonesLogEntry {
            i: U64(i),
            at: U64(at),
            kind: kind.into(),
            account: account.clone(),
            amount: U128(amount),
            supply_after: U128(self.bones_supply()),
            grave_id: U64(grave_id),
            note,
        };
        raw_set(&log_key(i), &e);
        raw_set(LOG_LEN_KEY, &(i + 1));
    }

    pub(crate) fn bones_mint(&mut self, to: &AccountId, amount: u128, grave_id: u64) {
        if amount == 0 {
            return;
        }
        let b = self.bones_balance(to);
        self.set_bones_balance(to, b + amount);
        raw_set(SUPPLY_KEY, &(self.bones_supply() + amount));
        let memo = format!("grave {} buried", grave_id);
        ft_event("ft_mint", json!({ "owner_id": to, "amount": U128(amount) }), Some(&memo));
        self.bones_log(now_secs(), "mint", to, amount, grave_id, memo);
    }

    /// Burn up to `amount` from `from`; returns what was actually burned.
    pub(crate) fn bones_burn(&mut self, from: &AccountId, amount: u128, grave_id: u64) -> u128 {
        let b = self.bones_balance(from);
        let x = b.min(amount);
        if x == 0 {
            return 0;
        }
        self.set_bones_balance(from, b - x);
        raw_set(SUPPLY_KEY, &(self.bones_supply() - x));
        let memo = format!("grave {} rose", grave_id);
        ft_event("ft_burn", json!({ "owner_id": from, "amount": U128(x) }), Some(&memo));
        self.bones_log(now_secs(), "burn", from, x, grave_id, memo);
        x
    }

    pub(crate) fn bones_transfer_internal(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: Option<&str>) {
        require!(from != to, "sender and receiver must differ");
        require!(amount > 0, "the amount must be positive");
        let fb = self.bones_balance(from);
        require!(fb >= amount, "not enough BONES");
        self.set_bones_balance(from, fb - amount);
        let tb = self.bones_balance(to);
        self.set_bones_balance(to, tb + amount);
        ft_event("ft_transfer", json!({ "old_owner_id": from, "new_owner_id": to, "amount": U128(amount) }), memo);
    }

    /// From `inter`: a weighted burial mints its weight in BONES into the
    /// grave's own account, so its earnings belong to whoever holds the NFT.
    pub(crate) fn bones_on_burial(&mut self, grave_id: u64, _owner: &AccountId, weight: u64) {
        if self.bones_genesis_event().is_none() || weight == 0 || env::storage_has_key(&grave_key(grave_id)) {
            return;
        }
        let acct = accounts::grave_account(&env::current_account_id(), grave_id);
        self.bones_mint(&acct, weight as u128, grave_id);
        raw_set(
            &grave_key(grave_id),
            &GraveBones { minted_to: acct.clone(), amount: U128(weight as u128), burned: U128(0), settled: false },
        );
        self.grave_log(grave_id, "bones_minted", Some(acct), Some(weight as u128), Some("BONES".into()), None);
    }

    /// From `apply_observation`, just before a rising is recorded: burn the BONES
    /// the risen plot's buriers still hold. BONES they already sold stay out there.
    pub(crate) fn bones_on_rising(&mut self, plot_id: &str) {
        if self.bones_genesis_event().is_none() {
            return;
        }
        for id in self.plot_graves.get(plot_id).cloned().unwrap_or_default() {
            let Some(mut gb) = raw_get::<GraveBones>(&grave_key(id)) else { continue };
            if gb.settled {
                continue;
            }
            let burned = self.bones_burn(&gb.minted_to, gb.amount.0, id);
            gb.burned = U128(burned);
            gb.settled = true;
            raw_set(&grave_key(id), &gb);
            self.grave_log(id, "bones_burned", Some(gb.minted_to), Some(burned), Some("BONES".into()), Some("its coin rose".into()));
        }
    }

    /// Every grave of a risen plot has been raised (its payout signed), so the
    /// tithe is on its way to the ossuary and shares can be paid from it.
    pub(crate) fn tithe_collected(&self, plot_id: &str) -> bool {
        self.plot_graves
            .get(plot_id)
            .map(|ids| ids.iter().all(|id| self.graves.get(*id as u32).is_some_and(|g| g.raised)))
            .unwrap_or(false)
    }

    pub(crate) fn bones_supply_at(&self, event_id: u32) -> Option<u128> {
        raw_get(&event_supply_key(event_id))
    }

    pub(crate) fn record_bones_supply_at(&mut self, event_id: u32, supply: u128) {
        raw_set(&event_supply_key(event_id), &supply);
    }

    /// A holder's share of a BONES-era rising, or why there is none.
    pub(crate) fn bones_share(&self, e: &ResurrectionEvent, holder: &AccountId) -> Result<u128, &'static str> {
        if !self.bones_era(e.id) {
            return Err("this rising predates $BONES; it pays per grave");
        }
        let supply = self.bones_supply_at(e.id).unwrap_or(0);
        if supply == 0 {
            return Err("no BONES existed at the rising");
        }
        let bal = self.bones_balance_at(holder, e.id);
        if bal == 0 {
            return Err("held no BONES at the rising");
        }
        let share = mul_div(e.pool_amount.0, bal, supply).ok_or("share overflows")?;
        if share == 0 {
            return Err("this share rounds to zero");
        }
        Ok(share)
    }

    /// Like `authorize`, for an account rather than a grave: named accounts call
    /// directly; wallet (implicit) accounts sign `account_message` with a nonce.
    pub(crate) fn authorize_account(&mut self, holder: &AccountId, action: &str, fields: &[(&str, String)], auth: Option<OwnerAuth>) {
        match auth::owner_kind(holder) {
            auth::OwnerKind::Named => {
                require!(env::predecessor_account_id() == *holder, "only the holder can do this");
            }
            _ => {
                let a = auth.unwrap_or_else(|| fail("a wallet signature from the holder is required"));
                let expected = self.nonces.get(holder).copied().unwrap_or(0);
                require!(a.nonce == expected, "stale or reused signature nonce");
                let msg = auth::account_message(env::current_account_id().as_str(), action, fields, a.nonce);
                require!(auth::verify_owner_signature(holder, &msg, &a.signature), "invalid holder signature");
                self.nonces.insert(holder.clone(), expected + 1);
            }
        }
    }
}

// ------------------------------------------------------------ public methods

#[near]
impl Contract {
    /// Start $BONES (owner, once). Every grave still resting with ossuary
    /// weight gets its weight in BONES; every rising from now on pays holders.
    pub fn bones_genesis(&mut self) -> U128 {
        self.assert_owner();
        require!(self.bones_genesis_event().is_none(), "$BONES has already started");
        raw_set(GENESIS_KEY, &self.events.len());
        for id in 0..self.graves.len() as u64 {
            let g = self.graves.get(id as u32).cloned().unwrap();
            // Resting or stirring: the grave still carries ossuary weight until its plot rises.
            let active = self.plots.get(&g.plot_id).is_some_and(|p| !matches!(p.state, PlotState::Risen { .. }));
            if active && g.weight_usd_e6.0 > 0 {
                self.bones_on_burial(id, &g.owner_id, g.weight_usd_e6.0);
            }
        }
        events::emit("bones_genesis", json!({ "first_event": self.events.len(), "supply": U128(self.bones_supply()) }));
        U128(self.bones_supply())
    }

    /// Claim a holder's share of a rising. Permissionless when the payout goes
    /// to the holder's own key on the risen chain; another recipient needs the
    /// holder's signature. The MPC network signs from the ossuary address.
    pub fn claim_bones(
        &mut self,
        event_id: u32,
        holder: AccountId,
        recipient: Option<String>,
        auth: Option<OwnerAuth>,
        solana: Option<SolanaFee>,
        evm: Option<EvmGas>,
    ) -> Promise {
        let e = self.events.get(event_id).cloned().unwrap_or_else(|| fail("event not found"));
        let ck = claim_key(event_id, &holder);
        require!(!env::storage_has_key(&ck), "already claimed");
        require!(self.tithe_collected(&e.plot_id), "raise the risen graves first: that's when the tithe reaches the ossuary");
        let share = self.bones_share(&e, &holder).unwrap_or_else(|r| fail(r));
        // A grave's account is run by whoever holds the grave NFT right now.
        let grave = accounts::grave_id_of(&holder, &env::current_account_id()).map(|id| self.grave_or_panic(id));
        let fields = [("event", event_id.to_string())];
        let recipient = match (recipient, &grave) {
            (Some(r), Some(g)) => {
                let r = canonical_address(e.chain, &r).unwrap_or_else(|x| fail(x));
                self.authorize(g, "claim_bones", &[fields[0].clone(), ("recipient", r.clone())], auth);
                r
            }
            (Some(r), None) => {
                let r = canonical_address(e.chain, &r).unwrap_or_else(|x| fail(x));
                self.authorize_account(&holder, "claim_bones", &[fields[0].clone(), ("recipient", r.clone())], auth);
                r
            }
            (None, Some(g)) => default_recipient(g, e.chain).unwrap_or_else(|| fail("the grave's holder must set a payout address on the risen token's chain")),
            (None, None) => account_recipient(&holder, e.chain).unwrap_or_else(|| fail("a recipient on the risen token's chain is required")),
        };
        env::storage_write(&ck, &share.to_le_bytes());
        if let Some(g) = &grave {
            self.grave_log(g.id, "earned", Some(g.owner_id.clone()), Some(share), Some(e.symbol.clone()), Some(format!("rising #{} via its BONES, paid to {}", event_id, recipient)));
        }
        events::emit("bones_claim", json!({ "event_id": event_id, "holder": holder, "amount": U128(share), "recipient": recipient }));
        self.sign_ossuary_payout(&e, recipient, share, format!("bones:{}:{}", event_id, holder), solana, evm)
    }

    /// Wallet-signed transfer, relayed by anyone: Solana and EVM holders move
    /// BONES without a NEAR account. Named NEAR accounts can use it or `ft_transfer`.
    pub fn bones_transfer(&mut self, holder: AccountId, receiver_id: AccountId, amount: U128, auth: Option<OwnerAuth>) {
        self.authorize_account(
            &holder,
            "transfer_bones",
            &[("receiver", receiver_id.to_string()), ("amount", amount.0.to_string())],
            auth,
        );
        self.bones_transfer_internal(&holder, &receiver_id, amount.0, Some("signed transfer"));
    }

    // ------------------------------------------------------------ NEP-141

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        self.bones_transfer_internal(&env::predecessor_account_id(), &receiver_id, amount.0, memo.as_deref());
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        near_sdk::assert_one_yocto();
        require!(env::prepaid_gas() > GAS_FT_CALL_MIN, "more gas is required");
        let sender = env::predecessor_account_id();
        self.bones_transfer_internal(&sender, &receiver_id, amount.0, memo.as_deref());
        ext_ft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FT_ON_TRANSFER)
            .ft_on_transfer(sender.clone(), amount, msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FT_RESOLVE)
                    .with_unused_gas_weight(0)
                    .ft_resolve_transfer(sender, receiver_id, amount),
            )
            .into()
    }

    /// Refund whatever the receiver didn't use (NEP-141). Returns the amount used.
    #[private]
    pub fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
        #[callback_result] used: Result<U128, PromiseError>,
    ) -> U128 {
        let unused = match used {
            Ok(u) => u.0.min(amount.0),
            Err(_) => amount.0,
        };
        let refund = unused.min(self.bones_balance(&receiver_id));
        if refund > 0 {
            self.bones_transfer_internal(&receiver_id, &sender_id, refund, Some("refund"));
        }
        U128(amount.0 - refund)
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.bones_supply())
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.bones_balance(&account_id))
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: "ft-1.0.0".into(),
            name: "Necropolis Bones".into(),
            symbol: "BONES".into(),
            icon: Some("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230c0b0a'/%3E%3Cpath d='M9 11.5a2.5 2.5 0 1 1 3-3.4l8 8a2.5 2.5 0 1 1 3.4 3 2.5 2.5 0 1 1-3 3.4l-8-8A2.5 2.5 0 1 1 9 11.5z' fill='%23ece6d8'/%3E%3C/svg%3E".into()),
            reference: None,
            reference_hash: None,
            decimals: BONES_DECIMALS,
        }
    }

    // NEP-145: every account is registered and the contract pays storage, so
    // deposits are refunded. Wallets and DEXs that check registration still work.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = (account_id, registration_only);
        let d = env::attached_deposit();
        if !d.is_zero() {
            let _ = Promise::new(env::predecessor_account_id()).transfer(d);
        }
        StorageBalance { total: U128(0), available: U128(0) }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        let _ = account_id;
        Some(StorageBalance { total: U128(0), available: U128(0) })
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: U128(0), max: Some(U128(0)) }
    }

    // ----------------------------------------------------------------- views

    pub fn get_bones_genesis(&self) -> Option<u32> {
        self.bones_genesis_event()
    }

    pub fn get_bones_rules(&self) -> BonesRules {
        let c = &self.config;
        BonesRules {
            symbol: "BONES".into(),
            decimals: BONES_DECIMALS,
            bones_per_usd_of_weight: U128(1),
            tithe_bps: c.tithe_bps,
            upkeep_bps: c.upkeep_bps,
            min_death_score: c.min_death_score,
            genesis_event: self.bones_genesis_event(),
            total_supply: U128(self.bones_supply()),
            mints_and_burns: U64(self.bones_log_len()),
            rules: vec![
                format!("Mint: a burial whose coin scores at least {} on the death score earns ossuary weight, capped per plot; 1 BONES is minted per $1 of weight, into the grave's own account.", c.min_death_score),
                "Burn: when a coin rises, the BONES still inside its graves' accounts are burned. BONES already exhumed and sold stay out there.".into(),
                format!("Pool: a rising sends {}% of every bag in its plot to the ossuary; {}% of that is upkeep, the rest is split among BONES holders.", c.tithe_bps / 100, c.upkeep_bps / 100),
                "Record date: each holder's share is their balance at the moment of the rising over the supply at that moment. BONES bought afterwards don't share in it.".into(),
                "Payout: a share can be claimed once the risen graves are raised (the tithe has reached the ossuary), and is signed out by the MPC network.".into(),
            ],
            setters: vec![],
        }
    }

    /// Every mint and burn since this log began, oldest first.
    pub fn get_bones_log(&self, from_index: Option<U64>, limit: Option<u64>) -> Vec<BonesLogEntry> {
        let from = from_index.map(|x| x.0).unwrap_or(0);
        let end = (from + limit.unwrap_or(50).min(100)).min(self.bones_log_len());
        (from..end).filter_map(|i| raw_get(&log_key(i))).collect()
    }

    pub fn get_grave_bones(&self, grave_id: u64) -> Option<GraveBones> {
        raw_get(&grave_key(grave_id))
    }

    pub fn get_bones_balance_at(&self, account_id: AccountId, event_id: u32) -> U128 {
        U128(self.bones_balance_at(&account_id, event_id))
    }

    pub fn get_bones_share(&self, event_id: u32, holder: AccountId) -> Option<BonesShareView> {
        let e = self.events.get(event_id)?.clone();
        let share = self.bones_share(&e, &holder);
        Some(BonesShareView {
            event_id,
            balance_at_rising: U128(self.bones_balance_at(&holder, event_id)),
            supply_at_rising: self.bones_supply_at(event_id).map(U128),
            amount: share.ok().map(U128),
            eligible: share.is_ok(),
            reason: share.err().map(String::from),
            claimed: env::storage_has_key(&claim_key(event_id, &holder)),
            holder,
        })
    }
}
