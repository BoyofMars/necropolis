//! Graves as accounts.
//!
//! Every grave NFT maps to a NEAR sub-account, `g<id>.<contract>`, created
//! with **no access keys**: nobody can ever sign for it, its old owner
//! included. Only this contract moves what it holds, and only for whoever holds
//! the NFT at that moment:
//!
//! * the grave's $BONES are minted **into** its account, so its share of every
//!   other coin's rising accrues to the NFT;
//! * claims on those shares pay the grave's *current* holder;
//! * the holder can exhume BONES to their own wallet (signed);
//! * when the grave's own coin rises, the BONES still inside are burned.
//!
//! Sell the grave and the account goes with it: its vault on Solana or Base,
//! its BONES, its unclaimed earnings and the right to act for it. Every grave
//! also keeps an on-chain history (buried, minted, earned, raised, burned,
//! exhumed, transferred) so anyone can see what it earned, what it paid out and
//! who held it. State lives under `grv:` storage keys, so no migration.

use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::{AccountId, NearToken, Promise, env, near, require};

use crate::*;

/// Storage for a keyless account record (~100 bytes), with headroom.
pub const GRAVE_ACCOUNT_DEPOSIT: NearToken = NearToken::from_millinear(2);
const HISTORY_CAP: usize = 200;

/// The NEAR account a grave NFT controls.
pub fn grave_account(contract: &AccountId, grave_id: u64) -> AccountId {
    format!("g{}.{}", grave_id, contract).parse().unwrap()
}

/// The grave behind a grave account, if `account` is one of ours.
pub fn grave_id_of(account: &AccountId, contract: &AccountId) -> Option<u64> {
    let digits = account.as_str().strip_suffix(contract.as_str())?.strip_suffix('.')?.strip_prefix('g')?;
    if digits.is_empty() || digits.len() > 12 || !digits.bytes().all(|b| b.is_ascii_digit()) || (digits.len() > 1 && digits.starts_with('0')) {
        return None;
    }
    digits.parse().ok()
}

fn history_key(grave_id: u64) -> Vec<u8> {
    format!("grv:h:{}", grave_id).into_bytes()
}
fn opened_key(grave_id: u64) -> Vec<u8> {
    format!("grv:acct:{}", grave_id).into_bytes()
}

/// One line of a grave's history.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraveEvent {
    pub at: U64,
    /// buried · bones_minted · earned · raised · bones_burned · bones_exhumed · transferred · epitaph
    pub kind: String,
    /// who it concerns: the holder, the new owner, or the account paid
    pub account: Option<AccountId>,
    pub amount: Option<U128>,
    pub symbol: Option<String>,
    pub note: Option<String>,
}

impl Contract {
    pub(crate) fn grave_log(
        &mut self,
        grave_id: u64,
        kind: &str,
        account: Option<AccountId>,
        amount: Option<u128>,
        symbol: Option<String>,
        note: Option<String>,
    ) {
        let mut h: Vec<GraveEvent> = raw_get(&history_key(grave_id)).unwrap_or_default();
        if h.len() >= HISTORY_CAP {
            h.remove(1); // keep the burial, drop the oldest after it
        }
        h.push(GraveEvent { at: U64(now_secs()), kind: kind.into(), account, amount: amount.map(U128), symbol, note });
        raw_set(&history_key(grave_id), &h);
    }

    /// Create the grave's keyless sub-account (once). A failed creation refunds the deposit.
    pub(crate) fn open_grave_account(&mut self, grave_id: u64) {
        if env::storage_has_key(&opened_key(grave_id)) {
            return;
        }
        env::storage_write(&opened_key(grave_id), &[1]);
        let _ = Promise::new(grave_account(&env::current_account_id(), grave_id))
            .create_account()
            .transfer(GRAVE_ACCOUNT_DEPOSIT);
    }

    pub(crate) fn plot_symbol(&self, plot_id: &str) -> Option<String> {
        self.plots.get(plot_id).map(|p| p.symbol.clone())
    }
}

#[near]
impl Contract {
    /// Owner, migration for graves minted before this upgrade: open their
    /// accounts and write the history the contract can reconstruct from state
    /// (burial, raise, per-grave claims, BONES minted and burned). Idempotent.
    pub fn open_grave_accounts(&mut self, from_index: u64, limit: u64) -> u64 {
        self.assert_owner();
        let end = (from_index + limit.min(20)).min(self.graves.len() as u64);
        let mut opened = 0;
        for id in from_index..end {
            if env::storage_has_key(&opened_key(id)) {
                continue;
            }
            let g = self.grave_or_panic(id);
            let symbol = self.plot_symbol(&g.plot_id);
            let mut h: Vec<GraveEvent> = vec![GraveEvent {
                at: g.buried_at,
                kind: "buried".into(),
                account: Some(g.owner_id.clone()),
                amount: Some(g.amount),
                symbol: symbol.clone(),
                note: Some(format!("{} into {}", g.chain.key(), g.grave_address)),
            }];
            if let Some(gb) = self.get_grave_bones(id) {
                h.push(GraveEvent { at: g.buried_at, kind: "bones_minted".into(), account: Some(gb.minted_to.clone()), amount: Some(gb.amount), symbol: Some("BONES".into()), note: Some("recorded at the accounts upgrade".into()) });
                if gb.settled {
                    h.push(GraveEvent { at: U64(now_secs()), kind: "bones_burned".into(), account: Some(gb.minted_to), amount: Some(gb.burned), symbol: Some("BONES".into()), note: Some("its plot rose; recorded at the accounts upgrade".into()) });
                }
            }
            for e in 0..self.events.len() {
                if let Some(amount) = self.claims.get(&format!("{}:{}", id, e)).copied() {
                    let ev = self.events.get(e).cloned().unwrap();
                    h.push(GraveEvent { at: ev.at, kind: "earned".into(), account: Some(g.owner_id.clone()), amount: Some(amount), symbol: Some(ev.symbol), note: Some(format!("rising #{} (per-grave share); time is the rising's", e)) });
                }
            }
            if let Some(p) = self.payouts.get(&format!("raise:{}", id)).cloned() {
                if let Some(at) = p.signed_at {
                    h.push(GraveEvent { at, kind: "raised".into(), account: Some(g.owner_id.clone()), amount: p.amounts.first().copied(), symbol: symbol.clone(), note: Some(format!("tithe {} to the ossuary", p.amounts.get(1).map(|x| x.0).unwrap_or(0))) });
                }
            }
            raw_set(&history_key(id), &h);
            self.open_grave_account(id);
            opened += 1;
        }
        opened
    }

    /// Move BONES out of a grave's account to its current holder (signed by
    /// the holder's wallet, or called by a named NEAR holder).
    pub fn exhume_bones(&mut self, grave_id: u64, amount: U128, auth: Option<OwnerAuth>) {
        let g = self.grave_or_panic(grave_id);
        self.authorize(&g, "exhume_bones", &[("amount", amount.0.to_string())], auth);
        let acct = grave_account(&env::current_account_id(), grave_id);
        self.bones_transfer_internal(&acct, &g.owner_id, amount.0, Some("exhumed"));
        self.grave_log(grave_id, "bones_exhumed", Some(g.owner_id.clone()), Some(amount.0), Some("BONES".into()), None);
        events::emit("bones_exhumed", json!({ "grave_id": grave_id, "to": g.owner_id, "amount": amount }));
    }

    /// The NEAR account a grave NFT controls.
    pub fn get_grave_account(&self, grave_id: u64) -> AccountId {
        require!(grave_id < self.graves.len() as u64, "grave not found");
        grave_account(&env::current_account_id(), grave_id)
    }

    /// What a grave earned, paid out and who held it, oldest first.
    pub fn get_grave_history(&self, grave_id: u64) -> Vec<GraveEvent> {
        raw_get(&history_key(grave_id)).unwrap_or_default()
    }
}
