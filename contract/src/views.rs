use crate::types::*;
use crate::{Config, Contract, ContractExt, grave_path};
use near_sdk::json_types::{U64, U128};
use near_sdk::serde::Serialize;
use near_sdk::{AccountId, near};

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Stats {
    pub graves: u64,
    pub plots: u32,
    pub events: u32,
    pub total_active_weight_usd_e6: U128,
    pub total_value_buried_usd_e6: U128,
    pub pending_burials_hint: bool,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ShareView {
    pub grave_id: u64,
    pub event_id: u32,
    pub amount: Option<U128>,
    pub eligible: bool,
    pub reason: Option<String>,
    pub claimed: bool,
}

#[near]
impl Contract {
    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_coroners(&self) -> Vec<AccountId> {
        self.coroners.iter().cloned().collect()
    }

    pub fn get_stats(&self) -> Stats {
        Stats {
            graves: self.graves.len() as u64,
            plots: self.plots.len(),
            events: self.events.len(),
            total_active_weight_usd_e6: U128(self.total_active_weight),
            total_value_buried_usd_e6: U128(self.total_value_buried_e6),
            pending_burials_hint: false,
        }
    }

    pub fn get_plot(&self, plot_id: String) -> Option<Plot> {
        self.plots.get(&plot_id).cloned()
    }

    pub fn get_plots(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Plot> {
        self.plots
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    pub fn get_grave(&self, grave_id: u64) -> Option<Grave> {
        if grave_id >= self.graves.len() as u64 {
            return None;
        }
        self.graves.get(grave_id as u32).cloned()
    }

    /// Newest first when `newest_first` is true.
    pub fn get_graves(&self, from_index: Option<u64>, limit: Option<u64>, newest_first: Option<bool>) -> Vec<Grave> {
        let n = self.graves.len() as u64;
        let limit = limit.unwrap_or(50).min(100);
        let from = from_index.unwrap_or(0);
        let ids: Vec<u64> = if newest_first.unwrap_or(false) {
            (0..n).rev().skip(from as usize).take(limit as usize).collect()
        } else {
            (from..n.min(from + limit)).collect()
        };
        ids.into_iter().filter_map(|i| self.graves.get(i as u32).cloned()).collect()
    }

    pub fn get_graves_by_owner(&self, owner_id: AccountId) -> Vec<Grave> {
        self.owner_graves
            .get(&owner_id)
            .map(|ids| ids.iter().filter_map(|i| self.graves.get(*i as u32).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_graves_by_plot(&self, plot_id: String, from_index: Option<u64>, limit: Option<u64>) -> Vec<Grave> {
        self.plot_graves
            .get(&plot_id)
            .map(|ids| {
                ids.iter()
                    .skip(from_index.unwrap_or(0) as usize)
                    .take(limit.unwrap_or(50).min(100) as usize)
                    .filter_map(|i| self.graves.get(*i as u32).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_events(&self) -> Vec<ResurrectionEvent> {
        self.events.iter().cloned().collect()
    }

    pub fn get_share(&self, grave_id: u64, event_id: u32) -> Option<ShareView> {
        let g = self.get_grave(grave_id)?;
        let e = self.events.get(event_id)?;
        let claimed = self.claims.contains_key(&format!("{}:{}", grave_id, event_id));
        Some(match self.share_of(&g, e) {
            Ok(a) => ShareView { grave_id, event_id, amount: Some(U128(a)), eligible: true, reason: None, claimed },
            Err(r) => ShareView { grave_id, event_id, amount: None, eligible: false, reason: Some(r.into()), claimed },
        })
    }

    pub fn get_payout(&self, key: String) -> Option<SignedPayout> {
        self.payouts.get(&key).cloned()
    }

    pub fn get_nonce(&self, owner_id: AccountId) -> U64 {
        U64(self.nonces.get(&owner_id).copied().unwrap_or(0))
    }

    pub fn get_ossuary(&self, chain: Chain) -> Option<String> {
        self.ossuaries.get(&chain).cloned()
    }

    /// Candle counts for the given graves, in order.
    pub fn get_candles(&self, grave_ids: Vec<u64>) -> Vec<U64> {
        grave_ids.into_iter().take(200).map(|id| U64(self.candles(id))).collect()
    }

    pub fn has_lit_candle(&self, grave_id: u64, mourner: AccountId) -> bool {
        self.has_lit(grave_id, &mourner)
    }

    /// The most-mourned graves, most candles first. Scans every grave, which
    /// is fine at testnet scale; past a few thousand graves this wants an
    /// incrementally maintained leaderboard.
    pub fn get_most_mourned(&self, limit: Option<u32>) -> Vec<(u64, U64)> {
        let mut all: Vec<(u64, u64)> =
            (0..self.graves.len() as u64).map(|id| (id, self.candles(id))).filter(|(_, n)| *n > 0).collect();
        all.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        all.into_iter().take(limit.unwrap_or(10).min(50) as usize).map(|(id, n)| (id, U64(n))).collect()
    }

    pub fn get_candle_total(&self) -> U64 {
        U64(self.candle_total())
    }

    /// AMM programs and stablecoins accepted for MPC-read markets.
    pub fn get_market_config(&self) -> MarketConfig {
        self.market_config()
    }

    /// The pool a plot's market is read from, once bound.
    pub fn get_pool_binding(&self, plot_id: String) -> Option<PoolBinding> {
        self.pool_binding(&plot_id)
    }

    /// The latest MPC-verified market reading for a plot.
    pub fn get_market_reading(&self, plot_id: String) -> Option<MarketReading> {
        self.market_reading(&plot_id)
    }

    pub fn get_pending(&self, path: String) -> Option<PendingBurial> {
        self.pending.get(&path).cloned()
    }

    pub fn grave_id_for_path(&self, path: String) -> Option<u64> {
        self.grave_by_path.get(&path).copied()
    }

    pub fn grave_id_for_deposit(&self, deposit_key: String) -> Option<u64> {
        self.deposits.get(&deposit_key).copied()
    }

    /// The derivation path for a would-be grave. The grave address is
    /// `derived_public_key(path, this contract)` on the MPC signer.
    pub fn get_grave_path(&self, chain: Chain, token: String, origin_owner: String, nonce: u32) -> String {
        let token = crate::canonical_address(chain, &token).unwrap_or(token);
        let owner = crate::canonical_address(chain, &origin_owner).unwrap_or(origin_owner);
        grave_path(chain, &token, &owner, nonce)
    }
}
