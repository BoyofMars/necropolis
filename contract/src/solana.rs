//! Minimal Solana legacy-message builder for payouts signed by chain signatures.
//!
//! The contract builds every byte it asks the MPC network to sign. Destination
//! token accounts are derived here (associated token account PDAs), never taken
//! from the caller, so a relayer cannot redirect a payout.

use curve25519_dalek::edwards::CompressedEdwardsY;
use near_sdk::env;

pub type Pubkey = [u8; 32];

pub const SYSTEM_PROGRAM: Pubkey = [0u8; 32];

pub fn b58(s: &str) -> Result<Pubkey, &'static str> {
    let v = bs58::decode(s).into_vec().map_err(|_| "invalid base58")?;
    if v.len() != 32 {
        return Err("expected a 32-byte public key");
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&v);
    Ok(out)
}

pub fn to_b58(k: &Pubkey) -> String {
    bs58::encode(k).into_string()
}

pub fn token_program() -> Pubkey {
    b58("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}
pub fn token_2022_program() -> Pubkey {
    b58("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb").unwrap()
}
pub fn ata_program() -> Pubkey {
    b58("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap()
}

pub fn is_on_curve(k: &Pubkey) -> bool {
    CompressedEdwardsY(*k).decompress().is_some()
}

pub fn find_program_address(seeds: &[&[u8]], program_id: &Pubkey) -> Option<(Pubkey, u8)> {
    for bump in (0u8..=255).rev() {
        let mut buf = Vec::with_capacity(32 * seeds.len() + 1 + 32 + 21);
        for s in seeds {
            buf.extend_from_slice(s);
        }
        buf.push(bump);
        buf.extend_from_slice(program_id);
        buf.extend_from_slice(b"ProgramDerivedAddress");
        let h = env::sha256_array(&buf);
        if !is_on_curve(&h) {
            return Some((h, bump));
        }
    }
    None
}

pub fn associated_token_address(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    find_program_address(&[owner, token_program, mint], &ata_program()).expect("ATA derivation").0
}

#[derive(Clone)]
pub struct AccountMeta {
    pub pubkey: Pubkey,
    pub signer: bool,
    pub writable: bool,
}

pub struct Instruction {
    pub program: Pubkey,
    pub accounts: Vec<AccountMeta>,
    pub data: Vec<u8>,
}

fn meta(pubkey: Pubkey, signer: bool, writable: bool) -> AccountMeta {
    AccountMeta { pubkey, signer, writable }
}

/// ATA program `CreateIdempotent` (instruction 1).
pub fn create_ata_idempotent(payer: Pubkey, owner: Pubkey, mint: Pubkey, token_program: Pubkey) -> Instruction {
    let ata = associated_token_address(&owner, &mint, &token_program);
    Instruction {
        program: ata_program(),
        accounts: vec![
            meta(payer, true, true),
            meta(ata, false, true),
            meta(owner, false, false),
            meta(mint, false, false),
            meta(SYSTEM_PROGRAM, false, false),
            meta(token_program, false, false),
        ],
        data: vec![1],
    }
}

/// SPL `TransferChecked` (instruction 12). Works for Token and Token-2022.
pub fn transfer_checked(
    source: Pubkey,
    mint: Pubkey,
    destination: Pubkey,
    authority: Pubkey,
    amount: u64,
    decimals: u8,
    token_program: Pubkey,
) -> Instruction {
    let mut data = vec![12u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    Instruction {
        program: token_program,
        accounts: vec![
            meta(source, false, true),
            meta(mint, false, false),
            meta(destination, false, true),
            meta(authority, true, false),
        ],
        data,
    }
}

fn compact_u16(out: &mut Vec<u8>, mut v: usize) {
    loop {
        let mut b = (v & 0x7f) as u8;
        v >>= 7;
        if v != 0 {
            b |= 0x80;
        }
        out.push(b);
        if v == 0 {
            break;
        }
    }
}

/// Compile and serialize a legacy message. The fee payer is always account 0.
pub fn compile_message(fee_payer: Pubkey, instructions: &[Instruction], blockhash: Pubkey) -> Vec<u8> {
    // Collect unique accounts, merging privileges.
    let mut keys: Vec<AccountMeta> = vec![meta(fee_payer, true, true)];
    let mut upsert = |m: &AccountMeta| {
        if let Some(k) = keys.iter_mut().find(|k| k.pubkey == m.pubkey) {
            k.signer |= m.signer;
            k.writable |= m.writable;
        } else {
            keys.push(m.clone());
        }
    };
    for ix in instructions {
        for a in &ix.accounts {
            upsert(a);
        }
        upsert(&meta(ix.program, false, false));
    }
    // Order: writable signers, readonly signers, writable non-signers, readonly non-signers.
    // Fee payer stays first. Stable within each class.
    let payer = keys.remove(0);
    let class = |m: &AccountMeta| match (m.signer, m.writable) {
        (true, true) => 0,
        (true, false) => 1,
        (false, true) => 2,
        (false, false) => 3,
    };
    let mut ordered = vec![payer];
    for c in 0..4 {
        for k in keys.iter().filter(|k| class(k) == c) {
            ordered.push(k.clone());
        }
    }
    let num_signers = ordered.iter().filter(|k| k.signer).count();
    let num_ro_signed = ordered.iter().filter(|k| k.signer && !k.writable).count();
    let num_ro_unsigned = ordered.iter().filter(|k| !k.signer && !k.writable).count();

    let index_of = |p: &Pubkey| ordered.iter().position(|k| &k.pubkey == p).unwrap() as u8;

    let mut out = vec![num_signers as u8, num_ro_signed as u8, num_ro_unsigned as u8];
    compact_u16(&mut out, ordered.len());
    for k in &ordered {
        out.extend_from_slice(&k.pubkey);
    }
    out.extend_from_slice(&blockhash);
    compact_u16(&mut out, instructions.len());
    for ix in instructions {
        out.push(index_of(&ix.program));
        compact_u16(&mut out, ix.accounts.len());
        for a in &ix.accounts {
            out.push(index_of(&a.pubkey));
        }
        compact_u16(&mut out, ix.data.len());
        out.extend_from_slice(&ix.data);
    }
    out
}

/// Raise a grave: owner share + tithe to the ossuary, both from the grave's
/// token account, signed by the grave address. A second execution fails
/// because the grave account no longer holds the tokens.
#[allow(clippy::too_many_arguments)]
pub fn raise_message(
    fee_payer: Pubkey,
    grave: Pubkey,
    grave_token_account: Pubkey,
    mint: Pubkey,
    token_program: Pubkey,
    decimals: u8,
    recipient: Pubkey,
    owner_amount: u64,
    ossuary: Pubkey,
    tithe: u64,
    blockhash: Pubkey,
) -> Vec<u8> {
    let recipient_ata = associated_token_address(&recipient, &mint, &token_program);
    let ossuary_ata = associated_token_address(&ossuary, &mint, &token_program);
    let mut ixs = vec![create_ata_idempotent(fee_payer, recipient, mint, token_program)];
    ixs.push(transfer_checked(grave_token_account, mint, recipient_ata, grave, owner_amount, decimals, token_program));
    if tithe > 0 {
        ixs.push(create_ata_idempotent(fee_payer, ossuary, mint, token_program));
        ixs.push(transfer_checked(grave_token_account, mint, ossuary_ata, grave, tithe, decimals, token_program));
    }
    compile_message(fee_payer, &ixs, blockhash)
}

/// Pay an ossuary share: transfer from the ossuary's ATA to the recipient's ATA.
#[allow(clippy::too_many_arguments)]
pub fn ossuary_payout_message(
    fee_payer: Pubkey,
    ossuary: Pubkey,
    mint: Pubkey,
    token_program: Pubkey,
    decimals: u8,
    recipient: Pubkey,
    amount: u64,
    blockhash: Pubkey,
) -> Vec<u8> {
    let source = associated_token_address(&ossuary, &mint, &token_program);
    let dest = associated_token_address(&recipient, &mint, &token_program);
    let ixs = vec![
        create_ata_idempotent(fee_payer, recipient, mint, token_program),
        transfer_checked(source, mint, dest, ossuary, amount, decimals, token_program),
    ];
    compile_message(fee_payer, &ixs, blockhash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_ata_derivation() {
        // ATA of a well-known wallet for USDC, checked against @solana/spl-token.
        let owner = b58("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM").unwrap();
        let mint = b58("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").unwrap();
        let ata = associated_token_address(&owner, &mint, &token_program());
        assert_eq!(to_b58(&ata), "FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B");
    }

    #[test]
    fn message_header_and_ordering() {
        let payer = [1u8; 32];
        let grave = [2u8; 32];
        let msg = raise_message(
            payer,
            grave,
            [3u8; 32],
            b58("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").unwrap(),
            token_program(),
            6,
            [4u8; 32],
            800,
            [5u8; 32],
            200,
            [9u8; 32],
        );
        // 2 signers (payer, grave), 1 readonly signer (grave)
        assert_eq!(msg[0], 2);
        assert_eq!(msg[1], 1);
        // payer first, then grave
        assert_eq!(&msg[4..36], &payer);
        assert_eq!(&msg[36..68], &grave);
    }
}
