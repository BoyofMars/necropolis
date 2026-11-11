//! Wallet-native ownership.
//!
//! A grave belongs to the key that buried it, expressed as a NEAR implicit
//! account id:
//!   - Solana (ed25519) pubkey  → 64 lowercase hex chars (NEAR implicit account)
//!   - EVM address              → 0x + 40 lowercase hex (NEP-518 eth-implicit account)
//!
//! Owners authorise actions by signing a human-readable message with the wallet
//! they already use (Phantom `signMessage`, EIP-191 `personal_sign`). The
//! contract verifies the signature natively, so users never need a NEAR wallet.

use near_sdk::{AccountId, env};

pub enum OwnerKind {
    Ed25519([u8; 32]),
    Evm([u8; 20]),
    Named,
}

pub fn owner_kind(owner: &AccountId) -> OwnerKind {
    let s = owner.as_str();
    if s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        let mut k = [0u8; 32];
        k.copy_from_slice(&hex::decode(s).unwrap());
        return OwnerKind::Ed25519(k);
    }
    if s.len() == 42 && s.starts_with("0x") && s[2..].bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        let mut a = [0u8; 20];
        a.copy_from_slice(&hex::decode(&s[2..]).unwrap());
        return OwnerKind::Evm(a);
    }
    OwnerKind::Named
}

/// Implicit account id for an origin-chain address.
pub fn implicit_owner(origin: &str, solana: bool) -> Result<AccountId, &'static str> {
    if solana {
        let k = crate::solana::b58(origin)?;
        hex::encode(k).parse().map_err(|_| "invalid implicit account")
    } else {
        let a = crate::evm::parse_address(origin)?;
        format!("0x{}", hex::encode(a)).parse().map_err(|_| "invalid eth-implicit account")
    }
}

/// Canonical message an owner signs. The web app builds the exact same string.
pub fn action_message(contract: &str, action: &str, grave_id: u64, fields: &[(&str, String)], nonce: u64) -> String {
    let mut m = format!("Necropolis v1\ncontract: {}\naction: {}\ngrave: {}\n", contract, action, grave_id);
    for (k, v) in fields {
        m.push_str(k);
        m.push_str(": ");
        m.push_str(v);
        m.push('\n');
    }
    m.push_str(&format!("nonce: {}", nonce));
    m
}

/// Canonical message for actions on an account rather than a grave ($BONES
/// transfers and claims). Same shape as `action_message`, without the grave line.
pub fn account_message(contract: &str, action: &str, fields: &[(&str, String)], nonce: u64) -> String {
    let mut m = format!("Necropolis v1\ncontract: {}\naction: {}\n", contract, action);
    for (k, v) in fields {
        m.push_str(k);
        m.push_str(": ");
        m.push_str(v);
        m.push('\n');
    }
    m.push_str(&format!("nonce: {}", nonce));
    m
}

fn decode_sig(sig: &str) -> Option<Vec<u8>> {
    if let Some(h) = sig.strip_prefix("0x") {
        return hex::decode(h).ok();
    }
    if sig.len() == 128 && sig.bytes().all(|c| c.is_ascii_hexdigit()) {
        return hex::decode(sig).ok();
    }
    bs58::decode(sig).into_vec().ok()
}

/// Verify `signature` over `message` for an implicit owner.
pub fn verify_owner_signature(owner: &AccountId, message: &str, signature: &str) -> bool {
    let Some(sig) = decode_sig(signature) else { return false };
    match owner_kind(owner) {
        OwnerKind::Ed25519(pk) => {
            if sig.len() != 64 {
                return false;
            }
            let mut s = [0u8; 64];
            s.copy_from_slice(&sig);
            env::ed25519_verify(&s, message.as_bytes(), &pk)
        }
        OwnerKind::Evm(addr) => {
            if sig.len() != 65 {
                return false;
            }
            let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
            let mut buf = prefix.into_bytes();
            buf.extend_from_slice(message.as_bytes());
            let hash = env::keccak256_array(&buf);
            let v = match sig[64] {
                27 | 28 => sig[64] - 27,
                0 | 1 => sig[64],
                _ => return false,
            };
            match env::ecrecover(&hash, &sig[..64], v, true) {
                Some(pk) => crate::evm::address_from_pubkey(&pk) == addr,
                None => false,
            }
        }
        OwnerKind::Named => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn implicit_ids() {
        let sol = implicit_owner("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", true).unwrap();
        assert_eq!(sol.as_str().len(), 64);
        let evm = implicit_owner("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01", false).unwrap();
        assert_eq!(evm.as_str(), "0xabcdef0123456789abcdef0123456789abcdef01");
        assert!(matches!(owner_kind(&evm), OwnerKind::Evm(_)));
        assert!(matches!(owner_kind(&sol), OwnerKind::Ed25519(_)));
        assert!(implicit_owner("not-an-address", true).is_err());
        assert!(implicit_owner("0x1234", false).is_err());
    }

    #[test]
    fn message_is_stable() {
        let m = action_message("necropolis.testnet", "set_epitaph", 7, &[("epitaph", "gm".into())], 3);
        assert_eq!(m, "Necropolis v1\ncontract: necropolis.testnet\naction: set_epitaph\ngrave: 7\nepitaph: gm\nnonce: 3");
    }

    #[test]
    fn rejects_garbage_signatures() {
        let sol = implicit_owner("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", true).unwrap();
        assert!(!verify_owner_signature(&sol, "hello", "0x00"));
        let evm = implicit_owner("0xabcdef0123456789abcdef0123456789abcdef01", false).unwrap();
        assert!(!verify_owner_signature(&evm, "hello", &format!("0x{}", "11".repeat(65))));
    }
}
