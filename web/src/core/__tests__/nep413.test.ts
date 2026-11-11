import { describe, expect, it } from "vitest";
import { KeyPairSigner } from "near-api-js";
import { nep413SignatureValid } from "@/server/nep413";

// A throwaway test key (never funded, never used on any network).
const SECRET = "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8tnFQuwoGUC51DowKqorvkr2pytJSnwuSbsNVfqygr";

describe("NEP-413 signatures (crypt sign-in for NEAR accounts)", () => {
  it("verifies a signature made by near-api-js, an independent implementation", async () => {
    const signer = KeyPairSigner.fromSecretKey(SECRET as `ed25519:${string}`);
    const nonce = new Uint8Array(32).map((_, i) => i + 1);
    const message = "Necropolis v1\ncontract: necropolis.testnet\naction: open_crypt\ngrave: 3\nissued: 1794400000";
    const s = await signer.signNep413Message("alice.testnet", { message, recipient: "necropolis.testnet", nonce });
    const n = {
      accountId: "alice.testnet",
      publicKey: s.publicKey.toString(),
      signature: Buffer.from(s.signature).toString("base64"),
      nonce: Buffer.from(nonce).toString("base64"),
    };
    expect(nep413SignatureValid(n, message, "necropolis.testnet")).toBe(true);
    // anything else in the envelope must break it
    expect(nep413SignatureValid(n, message.replace("grave: 3", "grave: 4"), "necropolis.testnet")).toBe(false);
    expect(nep413SignatureValid(n, message, "evil.testnet")).toBe(false);
    expect(nep413SignatureValid({ ...n, nonce: Buffer.alloc(32).toString("base64") }, message, "necropolis.testnet")).toBe(false);
  });
});
