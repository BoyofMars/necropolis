//! EIP-1559 ERC-20 transfer transactions, built inside the contract and signed
//! by chain signatures (secp256k1). The MPC network signs keccak256(0x02 || rlp).

use near_sdk::env;

pub type Address = [u8; 20];

pub fn parse_address(s: &str) -> Result<Address, &'static str> {
    let h = s.strip_prefix("0x").ok_or("EVM address must start with 0x")?;
    if h.len() != 40 {
        return Err("EVM address must be 20 bytes");
    }
    let v = hex::decode(h.to_ascii_lowercase()).map_err(|_| "EVM address is not hex")?;
    let mut a = [0u8; 20];
    a.copy_from_slice(&v);
    Ok(a)
}

pub fn address_hex(a: &Address) -> String {
    format!("0x{}", hex::encode(a))
}

/// EVM address from an uncompressed secp256k1 public key (64 bytes, x||y).
pub fn address_from_pubkey(xy: &[u8]) -> Address {
    let h = env::keccak256_array(xy);
    let mut a = [0u8; 20];
    a.copy_from_slice(&h[12..]);
    a
}

fn be_trim(v: u128) -> Vec<u8> {
    let b = v.to_be_bytes();
    let first = b.iter().position(|x| *x != 0).unwrap_or(16);
    b[first..].to_vec()
}

fn rlp_bytes(out: &mut Vec<u8>, data: &[u8]) {
    if data.len() == 1 && data[0] < 0x80 {
        out.push(data[0]);
    } else if data.len() < 56 {
        out.push(0x80 + data.len() as u8);
        out.extend_from_slice(data);
    } else {
        let len = be_trim(data.len() as u128);
        out.push(0xb7 + len.len() as u8);
        out.extend_from_slice(&len);
        out.extend_from_slice(data);
    }
}

fn rlp_uint(out: &mut Vec<u8>, v: u128) {
    rlp_bytes(out, &be_trim(v));
}

fn rlp_list(out: &mut Vec<u8>, payload: &[u8]) {
    if payload.len() < 56 {
        out.push(0xc0 + payload.len() as u8);
    } else {
        let len = be_trim(payload.len() as u128);
        out.push(0xf7 + len.len() as u8);
        out.extend_from_slice(&len);
    }
    out.extend_from_slice(payload);
}

/// transfer(address,uint256)
pub fn erc20_transfer_data(to: &Address, amount: u128) -> Vec<u8> {
    let mut d = vec![0xa9, 0x05, 0x9c, 0xbb];
    d.extend_from_slice(&[0u8; 12]);
    d.extend_from_slice(to);
    d.extend_from_slice(&[0u8; 16]);
    d.extend_from_slice(&amount.to_be_bytes());
    d
}

pub struct Eip1559 {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: Address,
    pub value: u128,
    pub data: Vec<u8>,
}

impl Eip1559 {
    fn fields(&self) -> Vec<u8> {
        let mut p = Vec::new();
        rlp_uint(&mut p, self.chain_id as u128);
        rlp_uint(&mut p, self.nonce as u128);
        rlp_uint(&mut p, self.max_priority_fee_per_gas);
        rlp_uint(&mut p, self.max_fee_per_gas);
        rlp_uint(&mut p, self.gas_limit as u128);
        rlp_bytes(&mut p, &self.to);
        rlp_uint(&mut p, self.value);
        rlp_bytes(&mut p, &self.data);
        rlp_list(&mut p, &[]); // access list
        p
    }

    /// 0x02 || rlp([...]) — the bytes whose keccak256 is signed.
    pub fn unsigned(&self) -> Vec<u8> {
        let mut out = vec![0x02];
        rlp_list(&mut out, &self.fields());
        out
    }

    pub fn signing_hash(&self) -> [u8; 32] {
        env::keccak256_array(&self.unsigned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rlp_basics() {
        let mut o = Vec::new();
        rlp_uint(&mut o, 0);
        assert_eq!(o, vec![0x80]);
        let mut o = Vec::new();
        rlp_uint(&mut o, 15);
        assert_eq!(o, vec![0x0f]);
        let mut o = Vec::new();
        rlp_uint(&mut o, 1024);
        assert_eq!(o, vec![0x82, 0x04, 0x00]);
    }

    #[test]
    fn transfer_calldata() {
        let to = parse_address("0x00000000000000000000000000000000000000aa").unwrap();
        let d = erc20_transfer_data(&to, 5);
        assert_eq!(d.len(), 68);
        assert_eq!(&d[0..4], &[0xa9, 0x05, 0x9c, 0xbb]);
        assert_eq!(d[35], 0xaa);
        assert_eq!(d[67], 5);
    }

    #[test]
    fn unsigned_tx_starts_with_type() {
        let tx = Eip1559 {
            chain_id: 84532,
            nonce: 0,
            max_priority_fee_per_gas: 1_000_000,
            max_fee_per_gas: 2_000_000_000,
            gas_limit: 90_000,
            to: [0x11; 20],
            value: 0,
            data: erc20_transfer_data(&[0x22; 20], 1),
        };
        let u = tx.unsigned();
        assert_eq!(u[0], 0x02);
        assert!(u[1] >= 0xf7 || u[1] >= 0xc0);
    }
}
