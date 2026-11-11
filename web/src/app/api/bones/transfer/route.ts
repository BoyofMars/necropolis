/**
 * Relay a wallet-signed $BONES transfer. The holder signs
 * `transfer_bones { receiver, amount, nonce }` with their Solana or EVM wallet;
 * the Sexton pays gas. Checked here first (signature, nonce, balance), then
 * again by the contract.
 */
import { bonesTransferMessage, registry } from "@/core/near";
import { receiverAccountId, signerKind } from "@/lib/ownerAction";
import { BurialError } from "@/server/burial";
import { body, fail, ok } from "@/server/respond";
import { callContractRaw } from "@/server/sexton";
import { walletSignatureValid } from "@/server/walletsig";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const i = await body<{ holder: string; receiver: string; amount: string; nonce: number; signature: string }>(req);
    if (typeof i.holder !== "string" || signerKind(i.holder) === "near") throw new BurialError("Holders sign with their Solana or EVM wallet.", "BAD_HOLDER");
    if (typeof i.amount !== "string" || !/^[1-9]\d{0,30}$/.test(i.amount)) throw new BurialError("Bad amount.", "BAD_AMOUNT");
    if (!Number.isInteger(i.nonce) || i.nonce < 0) throw new BurialError("Bad nonce.", "BAD_NONCE");
    if (typeof i.signature !== "string" || i.signature.length > 200) throw new BurialError("Bad signature.", "BAD_SIGNATURE");
    let receiver: string;
    try {
      receiver = receiverAccountId(i.receiver).accountId;
    } catch (e) {
      throw new BurialError((e as Error).message, "BAD_RECEIVER");
    }
    if (receiver === i.holder) throw new BurialError("That's your own account.", "SAME_ACCOUNT");
    if (BigInt(await registry.bonesBalance(i.holder)) < BigInt(i.amount)) throw new BurialError("Not enough BONES.", "BALANCE");
    if (Number(await registry.nonce(i.holder)) !== i.nonce) throw new BurialError("That signature was already used. Sign again.", "STALE_NONCE");
    if (!(await walletSignatureValid(i.holder, bonesTransferMessage(receiver, i.amount, i.nonce), i.signature))) {
      throw new BurialError("That signature doesn't match your wallet.", "BAD_SIGNATURE");
    }
    const res = await callContractRaw(
      "bones_transfer",
      { holder: i.holder, receiver_id: receiver, amount: i.amount, auth: { nonce: i.nonce, signature: i.signature } },
      30,
    );
    if (res.failure) throw new BurialError("NEAR rejected the transfer.", "REJECTED", 400);
    return ok({ receiver, nearTx: res.hash });
  } catch (e) {
    return fail(e);
  }
}
