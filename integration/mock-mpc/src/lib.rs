//! A stand-in for NEAR's MPC signer, for sandbox tests only.
//!
//! It answers the three calls Necropolis makes to `v1.signer-prod.testnet`
//! with the same argument and response shapes:
//!
//! - `derived_public_key`: a deterministic key per (predecessor, path, domain),
//!   so tests can compute every grave address in advance.
//! - `verify_foreign_transaction`: behaves like an honest MPC network. It
//!   answers only for origin-chain transactions it has "seen" (registered by the
//!   test with the payload hash of what is really on that chain), and like the
//!   real contract it refuses when the caller's `expected_payload_hash` differs.
//! - `sign`: a deterministic signature response. Necropolis stores it without
//!   checking it; whoever broadcasts the payout relies on the origin chain to.
//!
//! The real network is threshold MPC; this is a single honest party. What the
//! tests prove is the contract's side: it mints, rises and pays only on the
//! answers an honest network would give.

use near_sdk::serde_json::{Value, json};
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, PanicOnDefault, env, near, require};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockMpc {
    /// Origin-chain transaction id (hex) → sha256 payload hash of what that chain really holds.
    chain: LookupMap<String, String>,
    verifications: u32,
    signatures: u32,
}

/// The key the "network" derives for (predecessor, path, domain): 32 bytes for
/// EdDSA (an ed25519 public key's size), 64 for ECDSA (an uncompressed
/// secp256k1 point without its prefix). Deterministic, so tests can predict it.
pub fn derived_key_bytes(predecessor: &str, path: &str, domain_id: u64) -> Vec<u8> {
    let seed = env::sha256(format!("{}|{}|{}", predecessor, path, domain_id).as_bytes());
    if domain_id == 0 {
        let mut k = env::sha256(&[seed.as_slice(), b"x"].concat());
        k.extend(env::sha256(&[seed.as_slice(), b"y"].concat()));
        k
    } else {
        seed
    }
}

#[near]
impl MockMpc {
    #[init]
    pub fn new() -> Self {
        Self { chain: LookupMap::new(b"c"), verifications: 0, signatures: 0 }
    }

    /// Test hook: this transaction exists on the origin chain, and reading it
    /// produces this payload hash (hex).
    pub fn see_transaction(&mut self, tx_id: String, payload_hash: String) {
        self.chain.insert(tx_id.to_ascii_lowercase(), payload_hash.to_ascii_lowercase());
    }

    pub fn derived_public_key(&self, path: String, predecessor: Option<AccountId>, domain_id: Option<u64>) -> String {
        let predecessor = predecessor.unwrap_or_else(env::predecessor_account_id);
        let domain = domain_id.unwrap_or(0);
        let k = derived_key_bytes(predecessor.as_str(), &path, domain);
        if domain == 0 {
            format!("secp256k1:{}", bs58::encode(k).into_string())
        } else {
            format!("ed25519:{}", bs58::encode(k).into_string())
        }
    }

    /// `{ request: { request: { Solana | Base: { tx_id, … } }, domain_id, payload_version, expected_payload_hash } }`
    #[payable]
    pub fn verify_foreign_transaction(&mut self, request: Value) -> Value {
        let inner = &request["request"];
        let tx_id = inner["Solana"]["tx_id"]
            .as_str()
            .or_else(|| inner["Base"]["tx_id"].as_str())
            .unwrap_or_else(|| env::panic_str("unsupported foreign request"))
            .to_ascii_lowercase();
        let seen = self.chain.get(&tx_id).cloned().unwrap_or_else(|| env::panic_str("transaction not found on the origin chain"));
        if let Some(expected) = request["expected_payload_hash"].as_str() {
            require!(expected.eq_ignore_ascii_case(&seen), "payload does not match the origin chain");
        }
        self.verifications += 1;
        json!({ "payload_hash": seen, "signature": { "scheme": "mock", "big_r": "00", "s": "00" } })
    }

    /// `{ request: { path, payload_v2: { Eddsa | Ecdsa: hex }, domain_id } }`
    #[payable]
    pub fn sign(&mut self, request: Value) -> Value {
        let payload = request["payload_v2"]["Eddsa"].as_str().or_else(|| request["payload_v2"]["Ecdsa"].as_str()).unwrap_or_default();
        let path = request["path"].as_str().unwrap_or_default();
        self.signatures += 1;
        let sig = env::sha256(format!("{}|{}", path, payload).as_bytes());
        json!({ "scheme": "mock", "signature": hex::encode(sig) })
    }

    pub fn stats(&self) -> (u32, u32) {
        (self.verifications, self.signatures)
    }
}
