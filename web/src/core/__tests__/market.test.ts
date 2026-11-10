import { describe, expect, it } from "vitest";
import { expectedPayloadHash, verifyArgs } from "@/core/foreignTx";
import { revivalPlan } from "@/core/revival";
import vector from "./fixtures/mpc-market-vector.json";

describe("MPC-read market", () => {
  it("encodes a four-account read exactly as the MPC network signed it live", () => {
    const req = { chain: "Solana" as const, txSignatureHex: vector.anchor, accountsHex: vector.keys, finality: "Finalized" as const };
    expect(expectedPayloadHash(req, vector.values)).toBe(vector.hash);
    const args = verifyArgs(req, vector.hash) as { request: { request: { Solana: { extractors: unknown[] } } } };
    expect(args.request.request.Solana.extractors).toHaveLength(4);
  });

  it("plans a revival: buy up to the target price, then add liquidity", () => {
    // the dead NGMI pool: $300 against 483.87M tokens
    const plan = revivalPlan({ quoteUsd: 300, tokenReserve: 483_870_968, priceUsd: 300 / 483_870_968 }, { priceUsd: 0.0006, quoteUsd: 60_000 });
    // constant product: quote after the buy = sqrt(k × p) ≈ $9,333
    expect(plan.buyUsd).toBeGreaterThan(9_000);
    expect(plan.buyUsd).toBeLessThan(9_100);
    expect(plan.depositUsd).toBeCloseTo(60_000 - Math.sqrt(300 * 483_870_968 * 0.0006), 3);
    expect(plan.tokensForDeposit).toBeCloseTo(plan.depositUsd / 0.0006, 0);
  });

  it("does not buy a pool that is already above the target price", () => {
    const plan = revivalPlan({ quoteUsd: 20_000, tokenReserve: 10_000_000, priceUsd: 0.002 }, { priceUsd: 0.0006, quoteUsd: 60_000 });
    expect(plan.buyUsd).toBe(0);
    expect(plan.depositUsd).toBe(40_000);
  });
});
