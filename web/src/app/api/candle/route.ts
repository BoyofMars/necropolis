/**
 * Relay a wallet-signed candle to the contract. The mourner signs
 * `light_candle` for one grave with their Solana or EVM wallet; the Sexton
 * only pays gas. The signature and the one-candle-per-wallet rule are checked
 * here first (so junk costs nothing) and again by the contract.
 */
import { candleMessage, registry } from "@/core/near";
import { signerKind } from "@/lib/ownerAction";
import { BurialError } from "@/server/burial";
import { body, fail, ok } from "@/server/respond";
import { callContractRaw, parseEvents } from "@/server/sexton";
import { walletSignatureValid } from "@/server/walletsig";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { graveId, mourner, signature } = await body<{ graveId: number; mourner: string; signature: string }>(req);
    if (!Number.isInteger(graveId) || graveId < 0) throw new BurialError("Bad grave id.", "BAD_GRAVE");
    if (typeof mourner !== "string" || signerKind(mourner) === "near") throw new BurialError("Mourners sign with a Solana or EVM wallet.", "BAD_MOURNER");
    if (typeof signature !== "string" || signature.length > 200) throw new BurialError("Bad signature.", "BAD_SIGNATURE");
    if (!(await registry.grave(graveId))) throw new BurialError("Grave not found.", "NOT_FOUND", 404);
    if (await registry.hasLit(graveId, mourner)) throw new BurialError("You already lit a candle here.", "ALREADY_LIT", 409);
    if (!(await walletSignatureValid(mourner, candleMessage(graveId, mourner), signature))) {
      throw new BurialError("That signature doesn't match your wallet.", "BAD_SIGNATURE");
    }
    try {
      const res = await callContractRaw("light_candle", { grave_id: graveId, mourner, signature }, 30);
      if (res.failure) throw new Error(JSON.stringify(res.failure));
      const ev = parseEvents(res.logs).find((e) => e.event === "candle");
      return ok({ candles: Number(ev?.data.candles ?? 0), nearTx: res.hash });
    } catch (e) {
      const m = (e as Error).message ?? "";
      throw new BurialError(/already lit/.test(m) ? "You already lit a candle here." : "NEAR rejected the candle.", "REJECTED", 400);
    }
  } catch (e) {
    return fail(e);
  }
}
