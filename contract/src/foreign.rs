//! Borsh encoder for NEAR MPC foreign-chain transaction verification
//! (`v1.signer` >= 3.18.0, `verify_foreign_transaction`).
//!
//! The MPC network signs `sha256(borsh(ForeignTxSignPayload::V1 { request, values }))`.
//! When we pass `expected_payload_hash`, the MPC contract rejects any response
//! whose hash differs. We compute that hash from the deposit the relayer
//! *claims*, so a successful callback means the MPC network independently
//! observed exactly that deposit on Solana / Base.
//!
//! Layout transcribed from `near-mpc-contract-interface/src/types/foreign_chain.rs`.
//! Variant indices follow declaration order unless `use_discriminant = true`.

use near_sdk::env;

/// ForeignChainRpcRequest variant indices.
const RPC_SOLANA: u8 = 2;
const RPC_BASE: u8 = 6;
/// ExtractedValue variant indices.
const VALUE_EVM: u8 = 1;
const VALUE_SVM: u8 = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvmFinality {
    Latest = 0,
    Safe = 1,
    Finalized = 2,
}

impl EvmFinality {
    pub fn as_str(&self) -> &'static str {
        match self {
            EvmFinality::Latest => "Latest",
            EvmFinality::Safe => "Safe",
            EvmFinality::Finalized => "Finalized",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SvmFinality {
    Confirmed = 0,
    Finalized = 1,
}

impl SvmFinality {
    pub fn as_str(&self) -> &'static str {
        match self {
            SvmFinality::Confirmed => "Confirmed",
            SvmFinality::Finalized => "Finalized",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvmLog {
    pub removed: bool,
    pub log_index: u64,
    pub transaction_index: u64,
    pub transaction_hash: [u8; 32],
    pub block_hash: [u8; 32],
    pub block_number: u64,
    pub address: [u8; 20],
    pub data: String,
    pub topics: Vec<[u8; 32]>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SvmAccount {
    pub owner: [u8; 32],
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ForeignRequest {
    BaseLog { tx_hash: [u8; 32], log_index: u64, finality: EvmFinality },
    SolanaAccount { tx_signature: [u8; 64], account: [u8; 32], finality: SvmFinality },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExtractedValue {
    EvmLog(EvmLog),
    SvmAccount(SvmAccount),
}

#[derive(Default)]
struct W(Vec<u8>);

impl W {
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn raw(&mut self, b: &[u8]) {
        self.0.extend_from_slice(b);
    }
    fn bytes(&mut self, b: &[u8]) {
        self.u32(b.len() as u32);
        self.raw(b);
    }
}

fn encode_request(w: &mut W, req: &ForeignRequest) {
    match req {
        ForeignRequest::BaseLog { tx_hash, log_index, finality } => {
            w.u8(RPC_BASE);
            w.raw(tx_hash);
            w.u32(1);
            w.u8(1); // EvmExtractor::Log (explicit discriminant 1)
            w.u64(*log_index);
            w.u8(*finality as u8);
        }
        ForeignRequest::SolanaAccount { tx_signature, account, finality } => {
            w.u8(RPC_SOLANA);
            w.raw(tx_signature);
            w.u8(*finality as u8);
            w.u32(1);
            w.u8(2); // SvmExtractor::AccountState (explicit discriminant 2)
            w.raw(account);
        }
    }
}

fn encode_value(w: &mut W, v: &ExtractedValue) {
    match v {
        ExtractedValue::EvmLog(log) => {
            w.u8(VALUE_EVM);
            w.u8(1); // EvmExtractedValue::Log
            w.u8(log.removed as u8);
            w.u64(log.log_index);
            w.u64(log.transaction_index);
            w.raw(&log.transaction_hash);
            w.raw(&log.block_hash);
            w.u64(log.block_number);
            w.raw(&log.address);
            w.bytes(log.data.as_bytes());
            w.u32(log.topics.len() as u32);
            for t in &log.topics {
                w.raw(t);
            }
        }
        ExtractedValue::SvmAccount(acc) => {
            w.u8(VALUE_SVM);
            w.u8(1); // SvmExtractedValue::AccountState
            w.raw(&acc.owner);
            w.bytes(&acc.data);
        }
    }
}

/// borsh(ForeignTxSignPayload::V1 { request, values: vec![value] })
pub fn payload_bytes(req: &ForeignRequest, value: &ExtractedValue) -> Vec<u8> {
    let mut w = W::default();
    w.u8(0); // ForeignTxSignPayload::V1
    encode_request(&mut w, req);
    w.u32(1);
    encode_value(&mut w, value);
    w.0
}

pub fn expected_payload_hash(req: &ForeignRequest, value: &ExtractedValue) -> [u8; 32] {
    env::sha256_array(payload_bytes(req, value))
}

/// JSON args for `verify_foreign_transaction`.
pub fn verify_args_json(req: &ForeignRequest, expected: &[u8; 32], domain_id: u64) -> String {
    let inner = match req {
        ForeignRequest::BaseLog { tx_hash, log_index, finality } => format!(
            r#"{{"Base":{{"tx_id":"{}","extractors":[{{"Log":{{"log_index":{}}}}}],"finality":"{}"}}}}"#,
            hex::encode(tx_hash),
            log_index,
            finality.as_str()
        ),
        ForeignRequest::SolanaAccount { tx_signature, account, finality } => format!(
            r#"{{"Solana":{{"tx_id":"{}","finality":"{}","extractors":[{{"AccountState":{{"pubkey":"{}"}}}}]}}}}"#,
            hex::encode(tx_signature),
            finality.as_str(),
            hex::encode(account)
        ),
    };
    format!(
        r#"{{"request":{{"request":{},"domain_id":{},"payload_version":1,"expected_payload_hash":"{}"}}}}"#,
        inner,
        domain_id,
        hex::encode(expected)
    )
}

/// topic0 of ERC-20 `Transfer(address,address,uint256)`
pub const ERC20_TRANSFER_TOPIC: [u8; 32] = [
    0xdd, 0xf2, 0x52, 0xad, 0x1b, 0xe2, 0xc8, 0x9b, 0x69, 0xc2, 0xb0, 0x68, 0xfc, 0x37, 0x8d, 0xaa, 0x95, 0x2b,
    0xa7, 0xf1, 0x63, 0xc4, 0xa1, 0x16, 0x28, 0xf5, 0x5a, 0x4d, 0xf5, 0x23, 0xb3, 0xef,
];

pub struct Erc20Transfer {
    pub token: [u8; 20],
    pub from: [u8; 20],
    pub to: [u8; 20],
    pub amount: u128,
}

/// Parse an ERC-20 Transfer log. Amounts above u128 are rejected.
pub fn parse_erc20_transfer(log: &EvmLog) -> Result<Erc20Transfer, &'static str> {
    if log.removed {
        return Err("log was removed by a reorg");
    }
    if log.topics.len() != 3 || log.topics[0] != ERC20_TRANSFER_TOPIC {
        return Err("not an ERC-20 Transfer log");
    }
    let data = log.data.strip_prefix("0x").ok_or("log data must be 0x-prefixed")?;
    let bytes = hex::decode(data).map_err(|_| "log data is not hex")?;
    if bytes.len() != 32 {
        return Err("unexpected Transfer data length");
    }
    if bytes[..16].iter().any(|b| *b != 0) {
        return Err("amount exceeds u128");
    }
    let mut amt = [0u8; 16];
    amt.copy_from_slice(&bytes[16..]);
    let mut from = [0u8; 20];
    from.copy_from_slice(&log.topics[1][12..]);
    let mut to = [0u8; 20];
    to.copy_from_slice(&log.topics[2][12..]);
    if log.topics[1][..12].iter().any(|b| *b != 0) || log.topics[2][..12].iter().any(|b| *b != 0) {
        return Err("malformed address topic");
    }
    Ok(Erc20Transfer { token: log.address, from, to, amount: u128::from_be_bytes(amt) })
}

pub struct SplTokenAccount {
    pub mint: [u8; 32],
    pub owner: [u8; 32],
    pub amount: u64,
    pub state: u8,
    pub has_delegate: bool,
    pub has_close_authority: bool,
}

/// Parse the 165-byte base layout shared by SPL Token and Token-2022 accounts.
pub fn parse_spl_token_account(data: &[u8]) -> Result<SplTokenAccount, &'static str> {
    if data.len() < 165 {
        return Err("not an SPL token account");
    }
    let mut mint = [0u8; 32];
    mint.copy_from_slice(&data[0..32]);
    let mut owner = [0u8; 32];
    owner.copy_from_slice(&data[32..64]);
    let mut amt = [0u8; 8];
    amt.copy_from_slice(&data[64..72]);
    let has_delegate = data[72..76] != [0, 0, 0, 0];
    let state = data[108];
    let has_close_authority = data[129..133] != [0, 0, 0, 0];
    Ok(SplTokenAccount { mint, owner, amount: u64::from_le_bytes(amt), state, has_delegate, has_close_authority })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_topic_matches_keccak() {
        let h = env::keccak256_array(b"Transfer(address,address,uint256)");
        assert_eq!(h, ERC20_TRANSFER_TOPIC);
    }

    #[test]
    fn base_payload_layout() {
        let req = ForeignRequest::BaseLog { tx_hash: [0xaa; 32], log_index: 3, finality: EvmFinality::Safe };
        let log = EvmLog {
            removed: false,
            log_index: 3,
            transaction_index: 1,
            transaction_hash: [0xaa; 32],
            block_hash: [0xbb; 32],
            block_number: 42,
            address: [0x11; 20],
            data: "0x01".into(),
            topics: vec![[0x22; 32]],
        };
        let b = payload_bytes(&req, &ExtractedValue::EvmLog(log));
        // V1, Base, tx_id, 1 extractor, Log discriminant, log index, finality
        assert_eq!(b[0], 0);
        assert_eq!(b[1], RPC_BASE);
        assert_eq!(&b[2..34], &[0xaa; 32]);
        assert_eq!(&b[34..38], &1u32.to_le_bytes());
        assert_eq!(b[38], 1);
        assert_eq!(&b[39..47], &3u64.to_le_bytes());
        assert_eq!(b[47], 1);
        // values vec len, Evm, Log
        assert_eq!(&b[48..52], &1u32.to_le_bytes());
        assert_eq!(b[52], VALUE_EVM);
        assert_eq!(b[53], 1);
    }

    fn h32(s: &str) -> [u8; 32] {
        hex::decode(s).unwrap().try_into().unwrap()
    }

    /// Live vector: `v1.signer-prod.testnet` verified this Base Sepolia transfer
    /// (tx 0x8edb5c7f…, log 0, finality Safe) on 2026-11-10 and returned this payload hash.
    #[test]
    fn matches_live_mpc_base_sepolia_vector() {
        let req = ForeignRequest::BaseLog {
            tx_hash: h32("8edb5c7ffc18f953aea8fbcee15436996c99ca9707c78a662b53f4eb2bbcc1b4"),
            log_index: 0,
            finality: EvmFinality::Safe,
        };
        let mut address = [0u8; 20];
        address.copy_from_slice(&hex::decode("ae2066b99e9c0674f6f8cc4303074e84ea0c749f").unwrap());
        let log = EvmLog {
            removed: false,
            log_index: 0,
            transaction_index: 2,
            transaction_hash: h32("8edb5c7ffc18f953aea8fbcee15436996c99ca9707c78a662b53f4eb2bbcc1b4"),
            block_hash: h32("b967261bcd4733fc741ffd98492ba565053cb09d02beb606a1b72e211cf9dadb"),
            block_number: 0x364d7ff,
            address,
            data: "0x0000000000000000000000000000000000000000000000000000000005bdb181".into(),
            topics: vec![
                h32("ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"),
                h32("000000000000000000000000574d0c676a9beab18963468da010ba16bb2fe888"),
                h32("000000000000000000000000acbbcbcd97019a20596c405dc6d98188a05e285a"),
            ],
        };
        let got = hex::encode(expected_payload_hash(&req, &ExtractedValue::EvmLog(log)));
        assert_eq!(got, "51451c9a60023254548c1b846d2de8ab2d5e94f1baeef3e2067daeba93aaa674");
    }

    /// Live vector: `v1.signer-prod.testnet` read this Solana devnet USDC token
    /// account (tx HChEBT1f…, finality Finalized) on 2026-11-10.
    #[test]
    fn matches_live_mpc_solana_devnet_vector() {
        let sig: [u8; 64] = hex::decode(
            "0df8be784eac98f7151afb66202a42978dfaa99a192d4a01eed9f7ad63c8a30cc1e340dc6cf82629ee33863e14387cce65c88ac41e5247c9b7c037ba73334c0c",
        )
        .unwrap()
        .try_into()
        .unwrap();
        let req = ForeignRequest::SolanaAccount {
            tx_signature: sig,
            account: h32("6b103246aa2cb4b103610daa32c5a412293138ff1dbdaa24fab883019215f038"),
            finality: SvmFinality::Finalized,
        };
        let data = hex::decode("3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea774fe37289d66909485447d1e6f78e62aa70ecb1178ee09afdefe4c245fbe7f3cc80e060000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000").unwrap();
        let acc = parse_spl_token_account(&data).unwrap();
        assert_eq!(acc.amount, 397_000); // 0.397 USDC (6 decimals)
        assert_eq!(acc.state, 1);
        let value = ExtractedValue::SvmAccount(SvmAccount {
            owner: h32("06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9"),
            data,
        });
        let got = hex::encode(expected_payload_hash(&req, &value));
        assert_eq!(got, "0d3484bdcad08ba9ba19f1a6450f7261f1b1e4cac584ca8cc9bdaa7006518c82");
    }

    #[test]
    fn spl_account_parses() {
        let mut d = vec![0u8; 165];
        d[0..32].copy_from_slice(&[1u8; 32]);
        d[32..64].copy_from_slice(&[2u8; 32]);
        d[64..72].copy_from_slice(&1_000u64.to_le_bytes());
        d[108] = 1;
        let a = parse_spl_token_account(&d).unwrap();
        assert_eq!(a.mint, [1u8; 32]);
        assert_eq!(a.owner, [2u8; 32]);
        assert_eq!(a.amount, 1_000);
        assert_eq!(a.state, 1);
        assert!(!a.has_delegate);
    }
}
