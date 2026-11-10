use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, near};

/// Origin chains a grave can live on. The MPC testnet verifies Solana devnet
/// and Base Sepolia; mainnet verifies Solana and Base mainnet.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "kebab-case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Chain {
    Sol,
    Base,
    SolDevnet,
    BaseSepolia,
}

impl Chain {
    pub fn key(&self) -> &'static str {
        match self {
            Chain::Sol => "sol",
            Chain::Base => "base",
            Chain::SolDevnet => "sol-devnet",
            Chain::BaseSepolia => "base-sepolia",
        }
    }
    pub fn is_solana(&self) -> bool {
        matches!(self, Chain::Sol | Chain::SolDevnet)
    }
    pub fn is_testnet(&self) -> bool {
        matches!(self, Chain::SolDevnet | Chain::BaseSepolia)
    }
    pub fn evm_chain_id(&self) -> Option<u64> {
        match self {
            Chain::Base => Some(8453),
            Chain::BaseSepolia => Some(84532),
            _ => None,
        }
    }
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    Testnet,
    Mainnet,
}

/// The resurrection rule. Snapshotted into every plot when it opens, so the
/// terms a grave was buried under can never change afterwards.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Terms {
    pub min_liquidity_usd: U64,
    pub min_volume_24h_usd: U64,
    pub min_peak_volume_share_bps: u16,
    pub min_traders_24h: u32,
    pub max_volume_to_liquidity_x100: u32,
    pub min_mcap_multiple_x100: u32,
    pub min_mcap_usd: U64,
    pub max_flagged_share_bps: u16,
    pub min_sources: u8,
    pub window_secs: U64,
    pub max_gap_secs: U64,
    pub min_observations: u32,
}

impl Terms {
    pub fn mainnet() -> Self {
        Terms {
            min_liquidity_usd: U64(50_000),
            min_volume_24h_usd: U64(25_000),
            min_peak_volume_share_bps: 1_000,
            min_traders_24h: 100,
            max_volume_to_liquidity_x100: 2_000,
            min_mcap_multiple_x100: 500,
            min_mcap_usd: U64(250_000),
            max_flagged_share_bps: 3_000,
            min_sources: 2,
            window_secs: U64(14 * 86_400),
            max_gap_secs: U64(36 * 3_600),
            min_observations: 14,
        }
    }
    /// Same thresholds, compressed timers so the full rite can be demonstrated.
    pub fn testnet() -> Self {
        Terms { window_secs: U64(6 * 60), max_gap_secs: U64(3 * 60), min_observations: 3, ..Self::mainnet() }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Observation {
    /// unix seconds the coroner measured at
    pub t: U64,
    /// USD price scaled by 1e18
    pub price_usd_e18: U128,
    pub market_cap_usd: U64,
    pub liquidity_usd: U64,
    pub volume_24h_usd: U64,
    pub traders_24h: u32,
    pub flagged_share_bps: u16,
    pub sources: u8,
}

#[near(serializers = [borsh, json])]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlotState {
    Resting { false_dawns: u32, last_observed_at: Option<U64> },
    Stirring { since: U64, last_at: U64, count: u32, false_dawns: u32 },
    Risen { at: U64, false_dawns: u32, event_id: u32 },
}

/// All graves of one token. Opens with the first burial.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Plot {
    pub id: String,
    pub chain: Chain,
    pub token: String,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub image: Option<String>,
    pub terms: Terms,
    /// Market cap when the plot opened (dead-period median), USD
    pub baseline_mcap_usd: U64,
    /// Pre-death peak daily volume (7d rolling avg), USD
    pub peak_daily_volume_usd: U64,
    /// Max total ossuary weight this plot may carry (sybil limit), USD e6
    pub weight_cap_usd_e6: U64,
    pub opened_at: U64,
    pub state: PlotState,
    pub grave_count: u32,
    pub total_amount: U128,
    pub total_tithe: U128,
    pub total_weight_usd_e6: U64,
    pub observations: u32,
    pub last_observation: Option<Observation>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Grave {
    pub id: u64,
    pub plot_id: String,
    pub chain: Chain,
    pub token: String,
    /// NEAR implicit account derived from the depositor's own key:
    /// 64-hex for Solana (ed25519), 0x+40-hex for EVM (NEP-518). Or a named
    /// NEAR account after a transfer.
    pub owner_id: AccountId,
    /// Depositor's address on the origin chain (base58 or 0x)
    pub origin_owner: String,
    /// Chain-signature derivation path. The grave's address is derived from
    /// (this contract, path) and only this contract can sign for it.
    pub path: String,
    pub grave_address: String,
    /// Solana: the token account holding the buried tokens
    pub token_account: Option<String>,
    /// Solana: SPL Token or Token-2022 program that owns token_account
    pub token_program: Option<String>,
    pub decimals: u8,
    pub amount: U128,
    pub tithe: U128,
    pub value_usd_e6: U64,
    pub weight_usd_e6: U64,
    pub death_score: u8,
    pub epitaph: Option<String>,
    pub buried_at: U64,
    pub deposit_tx: String,
    pub deposit_log_index: Option<U64>,
    /// sha256 payload the MPC network signed when it verified the deposit
    pub proof_hash: String,
    /// Optional payout address override (same family as origin chain)
    pub payout_to: Option<String>,
    pub raised: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct ResurrectionEvent {
    pub id: u32,
    pub plot_id: String,
    pub chain: Chain,
    pub token: String,
    pub at: U64,
    /// Tokens of the risen plot that flow to the ossuary, minus upkeep
    pub pool_amount: U128,
    pub upkeep_amount: U128,
    /// Sum of weights of every grave (in other plots) resting at the moment of rising
    pub pool_weight_usd_e6: U128,
    pub decimals: u8,
    pub symbol: String,
}

/// Signed-transaction material produced by the MPC network for a payout.
/// Anyone can take this and broadcast it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct SignedPayout {
    pub kind: String,
    pub chain: Chain,
    /// hex of what was signed: Solana message bytes, or EVM unsigned tx (0x02||rlp)
    pub unsigned: Vec<String>,
    /// MPC signature responses, as returned by the signer (JSON)
    pub signatures: Vec<String>,
    pub requested_at: U64,
    pub signed_at: Option<U64>,
    pub recipient: String,
    pub amounts: Vec<U128>,
    pub path: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Appraisal {
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub image: Option<String>,
    /// value at burial, USD e6
    pub value_usd_e6: U64,
    /// requested ossuary weight, USD e6 (contract clamps to the plot cap)
    pub weight_usd_e6: U64,
    pub death_score: u8,
    pub model_version: String,
    /// required when this burial opens a new plot
    pub plot: Option<PlotBaseline>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PlotBaseline {
    pub baseline_mcap_usd: U64,
    pub peak_daily_volume_usd: U64,
    pub weight_cap_usd_e6: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct EvmLogArg {
    pub removed: bool,
    pub log_index: U64,
    pub transaction_index: U64,
    pub transaction_hash: String,
    pub block_hash: String,
    pub block_number: U64,
    pub address: String,
    pub data: String,
    pub topics: Vec<String>,
}

#[near(serializers = [borsh, json])]
#[serde(tag = "kind", rename_all = "lowercase")]
#[derive(Clone, Debug)]
pub enum DepositProof {
    /// The grave's token account, read by the MPC network after the deposit tx.
    Solana {
        tx_signature: String,
        token_account: String,
        account_program: String,
        account_data_hex: String,
    },
    /// The ERC-20 Transfer log of the deposit.
    Evm { log: EvmLogArg },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct BuryArgs {
    pub chain: Chain,
    pub token: String,
    pub origin_owner: String,
    pub nonce: u32,
    pub deposit: DepositProof,
    pub appraisal: Appraisal,
    pub epitaph: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PendingBurial {
    pub args: BuryArgs,
    pub path: String,
    pub deposit_key: String,
    pub grave_address: Option<String>,
    pub amount: Option<U128>,
    pub expected_hash: Option<String>,
    pub token_program: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct EvmGas {
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub gas_limit: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SolanaFee {
    /// fee payer pubkey (base58); signs the message off-chain, pays fees and rent
    pub fee_payer: String,
    /// recent blockhash (base58)
    pub blockhash: String,
}

/// Wallet signature authorising an owner action, for owners without a NEAR wallet.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct OwnerAuth {
    pub nonce: u64,
    /// Solana: base58 or hex 64-byte ed25519 signature. EVM: 0x hex 65-byte signature.
    pub signature: String,
}
