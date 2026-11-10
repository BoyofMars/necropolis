import { describe, expect, it } from "vitest";
import { actionMessage, CONTRACT_ID } from "@/core/near";
import { canonicalPayout, receiverAccountId, signerKind } from "@/lib/ownerAction";

describe("owner action messages", () => {
  it("matches the contract's canonical message byte for byte", () => {
    // Same vector as contract/src/auth.rs `message_format`.
    expect(actionMessage("set_epitaph", 7, [["epitaph", "gm"]], 3)).toBe(
      `Necropolis v1\ncontract: ${CONTRACT_ID}\naction: set_epitaph\ngrave: 7\nepitaph: gm\nnonce: 3`,
    );
  });

  it("maps a Solana address to its 64-hex implicit account", () => {
    const r = receiverAccountId(" 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM ");
    expect(r.kind).toBe("solana");
    expect(r.accountId).toMatch(/^[0-9a-f]{64}$/);
    expect(signerKind(r.accountId)).toBe("solana");
  });

  it("lowercases EVM receivers into eth-implicit accounts", () => {
    const r = receiverAccountId("0xABCDEF0123456789abcdef0123456789ABCDEF01");
    expect(r).toEqual({ accountId: "0xabcdef0123456789abcdef0123456789abcdef01", kind: "evm" });
    expect(signerKind(r.accountId)).toBe("evm");
  });

  it("accepts named NEAR accounts and rejects junk", () => {
    expect(receiverAccountId("alice.testnet")).toEqual({ accountId: "alice.testnet", kind: "near" });
    expect(() => receiverAccountId("not an account!")).toThrow();
  });

  it("canonicalises payout addresses the way the contract stores them", () => {
    expect(canonicalPayout("base-sepolia", "0xAbCdEf0123456789abcdef0123456789aBcDeF01")).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
    expect(canonicalPayout("sol-devnet", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    expect(() => canonicalPayout("sol-devnet", "0xabcdef0123456789abcdef0123456789abcdef01")).toThrow();
    expect(() => canonicalPayout("base-sepolia", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toThrow();
  });
});
