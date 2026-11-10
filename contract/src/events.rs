//! NEP-297 event logs. Every burial, observation, rising and payout is a
//! public, indexable log line.

use near_sdk::serde_json::{Value, json};
use near_sdk::{AccountId, env};

pub fn emit(event: &str, data: Value) {
    let line = json!({ "standard": "necropolis", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{}", line));
}

pub fn nft_mint(owner: &AccountId, id: u64) {
    let line = json!({
        "standard": "nep171",
        "version": "1.2.0",
        "event": "nft_mint",
        "data": [{ "owner_id": owner, "token_ids": [id.to_string()] }],
    });
    env::log_str(&format!("EVENT_JSON:{}", line));
}

pub fn nft_transfer(from: &AccountId, to: &AccountId, id: u64, memo: Option<String>) {
    let mut d = json!({ "old_owner_id": from, "new_owner_id": to, "token_ids": [id.to_string()] });
    if let Some(m) = memo {
        d["memo"] = json!(m);
    }
    let line = json!({ "standard": "nep171", "version": "1.2.0", "event": "nft_transfer", "data": [d] });
    env::log_str(&format!("EVENT_JSON:{}", line));
}
