import { describe, expect, it } from "vitest";
import { deriveEvmAddress, deriveSolanaAddress, ROOT_KEYS } from "../derivation";

/**
 * Vectors: the deployed contract `bagyard.testnet` asked the live MPC signer
 * (`v1.signer-prod.testnet`, derived_public_key) for its ossuary addresses.
 */
describe("chain-signature derivation", () => {
  it("matches the MPC network for an ed25519 (Solana) child key", () => {
    expect(deriveSolanaAddress(ROOT_KEYS.testnet.ed25519, "bagyard.testnet", "ossuary/v1/sol-devnet")).toBe(
      "8aHiZwLc3uSVK1GdpQUR2Sg6VjKeG7N7jGYkzfMSm81v",
    );
  });

  it("matches the MPC network for a secp256k1 (EVM) child key", () => {
    expect(deriveEvmAddress(ROOT_KEYS.testnet.secp256k1, "bagyard.testnet", "ossuary/v1/base-sepolia")).toBe(
      "0x2aeeac585dd3d53db02809a59a43ca742fd302dd",
    );
  });

  it("is path- and account-specific", () => {
    const a = deriveSolanaAddress(ROOT_KEYS.testnet.ed25519, "bagyard.testnet", "bag/v1/sol-devnet/x/y/1");
    const b = deriveSolanaAddress(ROOT_KEYS.testnet.ed25519, "bagyard.testnet", "bag/v1/sol-devnet/x/y/2");
    const c = deriveSolanaAddress(ROOT_KEYS.testnet.ed25519, "evil.testnet", "bag/v1/sol-devnet/x/y/1");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
