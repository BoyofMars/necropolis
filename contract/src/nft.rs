//! NEP-171 / NEP-177 / NEP-181 surface for graves.
//!
//! A grave is a functional NFT: it is the claim on a native-chain address the
//! contract controls, on the owner share when its plot rises, and on a slice of
//! every other plot's tithe. Transferring the NFT transfers all of that.
//! The media URL points at a live image that changes with the grave's state.

use crate::types::Grave;
use crate::{Contract, ContractExt};
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{AccountId, NearToken, assert_one_yocto, env, near, require};

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: TokenMetadata,
}

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23141210'/%3E%3Cpath d='M9 26V14a7 7 0 0 1 14 0v12z' fill='none' stroke='%23e9e2d3' stroke-width='2'/%3E%3Cpath d='M11 20h3l1.5-3 2 6 1.5-3h2' fill='none' stroke='%23f0b14a' stroke-width='1.6'/%3E%3C/svg%3E";

impl Contract {
    pub(crate) fn token_for(&self, g: &Grave) -> Token {
        let plot = self.plots.get(&g.plot_id);
        let symbol = plot.map(|p| p.symbol.clone()).unwrap_or_default();
        let state = plot.map(|p| match p.state {
            crate::types::PlotState::Resting { .. } => "resting",
            crate::types::PlotState::Stirring { .. } => "stirring",
            crate::types::PlotState::Risen { .. } => "risen",
        });
        let extra = near_sdk::serde_json::json!({
            "chain": g.chain,
            "token": g.token,
            "amount": g.amount,
            "grave_address": g.grave_address,
            "state": state,
            "raised": g.raised,
            "weight_usd_e6": g.weight_usd_e6,
        });
        Token {
            token_id: g.id.to_string(),
            owner_id: g.owner_id.clone(),
            metadata: TokenMetadata {
                title: Some(format!("Grave No. {:06} · ${}", g.id, symbol)),
                description: Some(match &g.epitaph {
                    Some(e) => format!("\u{201c}{}\u{201d}", e),
                    None => format!("Here lies ${}. Buried on {}.", symbol, g.chain.key()),
                }),
                media: Some(format!("{}/image.svg", g.id)),
                media_hash: None,
                copies: Some(1),
                issued_at: Some((g.buried_at.0 * 1000).to_string()),
                expires_at: None,
                starts_at: None,
                updated_at: None,
                extra: Some(extra.to_string()),
                reference: None,
                reference_hash: None,
            },
        }
    }
}

#[near]
impl Contract {
    pub fn nft_metadata(&self) -> NftContractMetadata {
        NftContractMetadata {
            spec: "nft-1.0.0".into(),
            name: "Bagyard Graves".into(),
            symbol: "GRAVE".into(),
            icon: Some(ICON.into()),
            base_uri: self.config.nft_base_uri.clone(),
            reference: None,
            reference_hash: None,
        }
    }

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        let id: u32 = token_id.parse().ok()?;
        self.graves.get(id).map(|g| self.token_for(g))
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.graves.len() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let start = from_index.map(|x| x.0 as u32).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as u32;
        (start..self.graves.len().min(start.saturating_add(limit)))
            .filter_map(|i| self.graves.get(i).map(|g| self.token_for(g)))
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.owner_graves.get(&account_id).map(|v| v.len()).unwrap_or(0) as u128)
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let ids = self.owner_graves.get(&account_id).cloned().unwrap_or_default();
        let start = from_index.map(|x| x.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        ids.iter()
            .skip(start)
            .take(limit)
            .filter_map(|id| self.graves.get(*id as u32).map(|g| self.token_for(g)))
            .collect()
    }

    /// NEP-171 transfer for graves owned by named NEAR accounts.
    #[payable]
    pub fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(approval_id.is_none(), "approvals are not supported");
        let id: u64 = token_id.parse().unwrap_or_else(|_| env::panic_str("invalid token id"));
        let g = self.grave_or_panic(id);
        require!(env::predecessor_account_id() == g.owner_id, "only the grave's owner can transfer it");
        let _ = NearToken::from_yoctonear(1);
        self.internal_transfer(id, &g.owner_id, &receiver_id, memo);
    }
}
