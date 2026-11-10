/**
 * Chain registry and token identity.
 *
 * A token is identified by (chain, address). Chain ids are short, stable
 * strings used everywhere (URLs, contract state, API routes). We also expose
 * CAIP-2 / CAIP-19 identifiers so the data model stays interoperable.
 */
import bs58 from "bs58";

export type ChainId = "sol" | "base" | "sol-devnet" | "base-sepolia";
export type ChainFamily = "solana" | "evm";

export interface ChainInfo {
  id: ChainId;
  family: ChainFamily;
  name: string;
  shortName: string;
  network: "mainnet" | "testnet";
  /** CAIP-2 chain id */
  caip2: string;
  /** EVM numeric chain id */
  evmChainId?: number;
  explorer: {
    tx: (hash: string) => string;
    address: (addr: string) => string;
    token: (addr: string) => string;
  };
  /** DexScreener chain slug (mainnet only) */
  dexscreener?: string;
  /** GeckoTerminal network slug (mainnet only) */
  geckoterminal?: string;
  /** The mainnet this testnet mirrors */
  mirrors?: ChainId;
  nativeSymbol: string;
}

const solscan = (cluster?: string) => {
  const q = cluster ? `?cluster=${cluster}` : "";
  return {
    tx: (h: string) => `https://solscan.io/tx/${h}${q}`,
    address: (a: string) => `https://solscan.io/account/${a}${q}`,
    token: (a: string) => `https://solscan.io/token/${a}${q}`,
  };
};

const blockscout = (host: string) => ({
  tx: (h: string) => `https://${host}/tx/${h}`,
  address: (a: string) => `https://${host}/address/${a}`,
  token: (a: string) => `https://${host}/token/${a}`,
});

export const CHAINS: Record<ChainId, ChainInfo> = {
  sol: {
    id: "sol",
    family: "solana",
    name: "Solana",
    shortName: "SOL",
    network: "mainnet",
    caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    explorer: solscan(),
    dexscreener: "solana",
    geckoterminal: "solana",
    nativeSymbol: "SOL",
  },
  base: {
    id: "base",
    family: "evm",
    name: "Base",
    shortName: "BASE",
    network: "mainnet",
    caip2: "eip155:8453",
    evmChainId: 8453,
    explorer: blockscout("base.blockscout.com"),
    dexscreener: "base",
    geckoterminal: "base",
    nativeSymbol: "ETH",
  },
  "sol-devnet": {
    id: "sol-devnet",
    family: "solana",
    name: "Solana Devnet",
    shortName: "SOL·DEV",
    network: "testnet",
    caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    explorer: solscan("devnet"),
    mirrors: "sol",
    nativeSymbol: "SOL",
  },
  "base-sepolia": {
    id: "base-sepolia",
    family: "evm",
    name: "Base Sepolia",
    shortName: "BASE·SEP",
    network: "testnet",
    caip2: "eip155:84532",
    evmChainId: 84532,
    explorer: blockscout("base-sepolia.blockscout.com"),
    mirrors: "base",
    nativeSymbol: "ETH",
  },
};

export const MAINNET_CHAINS: ChainId[] = ["sol", "base"];
export const TESTNET_CHAINS: ChainId[] = ["sol-devnet", "base-sepolia"];

export function isChainId(v: string): v is ChainId {
  return v in CHAINS;
}

export function chain(id: ChainId): ChainInfo {
  return CHAINS[id];
}

/** Solana addresses are base58-encoded 32-byte public keys. */
export function isSolanaAddress(v: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false;
  try {
    return bs58.decode(v).length === 32;
  } catch {
    return false;
  }
}

export function isEvmAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

export class TokenIdentityError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "UNKNOWN_CHAIN"
      | "INVALID_ADDRESS"
      | "CHAIN_MISMATCH"
      | "NATIVE_ASSET",
  ) {
    super(message);
    this.name = "TokenIdentityError";
  }
}

/** Well-known assets that can never be buried (they are not memecoins). */
const NON_BURIABLE: Record<ChainFamily, Set<string>> = {
  solana: new Set([
    "So11111111111111111111111111111111111111112", // wSOL
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  ]),
  evm: new Set([
    "0x4200000000000000000000000000000000000006", // WETH on Base
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC on Base
  ]),
};

export interface TokenRef {
  chain: ChainId;
  /** Canonical address: base58 mint for Solana, lowercase 0x for EVM */
  address: string;
}

/**
 * Validate and canonicalise a (chain, address) pair. Rejects addresses that
 * belong to the other chain family, which is the most common user error when
 * pasting tokens ("this is a Base address, not a Solana mint").
 */
export function normalizeToken(chainId: string, address: string): TokenRef {
  if (!isChainId(chainId)) {
    throw new TokenIdentityError(`Unknown chain "${chainId}"`, "UNKNOWN_CHAIN");
  }
  const info = CHAINS[chainId];
  const raw = address.trim();
  if (info.family === "solana") {
    if (isEvmAddress(raw)) {
      throw new TokenIdentityError(
        "That looks like an EVM (Base) address, not a Solana mint.",
        "CHAIN_MISMATCH",
      );
    }
    if (!isSolanaAddress(raw)) {
      throw new TokenIdentityError("Not a valid Solana mint address.", "INVALID_ADDRESS");
    }
    if (NON_BURIABLE.solana.has(raw)) {
      throw new TokenIdentityError("Native and stable assets cannot be buried.", "NATIVE_ASSET");
    }
    return { chain: chainId, address: raw };
  }
  if (isSolanaAddress(raw) && !raw.startsWith("0x")) {
    throw new TokenIdentityError(
      "That looks like a Solana mint, not a Base (EVM) token address.",
      "CHAIN_MISMATCH",
    );
  }
  if (!isEvmAddress(raw)) {
    throw new TokenIdentityError("Not a valid EVM token address.", "INVALID_ADDRESS");
  }
  const lower = raw.toLowerCase();
  if (NON_BURIABLE.evm.has(lower)) {
    throw new TokenIdentityError("Native and stable assets cannot be buried.", "NATIVE_ASSET");
  }
  return { chain: chainId, address: lower };
}

/** Detect which chain family a pasted address belongs to. */
export function detectFamily(address: string): ChainFamily | null {
  const v = address.trim();
  if (isEvmAddress(v)) return "evm";
  if (isSolanaAddress(v)) return "solana";
  return null;
}

export function tokenKey(t: TokenRef): string {
  return `${t.chain}:${t.address}`;
}

export function parseTokenKey(key: string): TokenRef {
  const idx = key.indexOf(":");
  if (idx < 0) throw new TokenIdentityError("Malformed token key", "INVALID_ADDRESS");
  return normalizeToken(key.slice(0, idx), key.slice(idx + 1));
}

export function caip19(t: TokenRef): string {
  const info = CHAINS[t.chain];
  return info.family === "solana" ? `${info.caip2}/token:${t.address}` : `${info.caip2}/erc20:${t.address}`;
}

export function shortAddress(a: string, head = 4, tail = 4): string {
  if (a.length <= head + tail + 1) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}
