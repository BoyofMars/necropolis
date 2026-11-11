/**
 * Relay a wallet-signed owner action to the contract. The Sexton only pays
 * NEAR gas: the contract verifies the owner's ed25519 (Solana) or EIP-191
 * (EVM) signature over the canonical action message itself, with a nonce, so
 * the relayer cannot forge, alter or replay an action.
 *
 * The same checks run here first, so forged or replayed requests are turned
 * away before they cost the Sexton gas.
 */
import { actionMessage, registry } from "@/core/near";
import { signerKind } from "@/lib/ownerAction";
import { BurialError } from "@/server/burial";
import { body, fail, ok } from "@/server/respond";
import { callContractRaw, parseEvents } from "@/server/sexton";
import { walletSignatureValid } from "@/server/walletsig";

export const maxDuration = 30;

type Action = "set_epitaph" | "transfer_grave" | "set_payout_address" | "exhume_bones";
interface Input {
  action: Action;
  graveId: number;
  value: string;
  nonce: number;
  signature: string;
}

/** Contract argument name, and the field name inside the signed message. */
const FIELD: Record<Action, [arg: string, msg: string]> = {
  set_epitaph: ["epitaph", "epitaph"],
  transfer_grave: ["receiver_id", "receiver"],
  set_payout_address: ["address", "address"],
  exhume_bones: ["amount", "amount"],
};

export async function POST(req: Request) {
  try {
    const i = await body<Input>(req);
    if (!Object.hasOwn(FIELD, i.action)) throw new BurialError("Unknown action.", "BAD_ACTION");
    if (!Number.isInteger(i.graveId) || i.graveId < 0) throw new BurialError("Bad grave id.", "BAD_GRAVE");
    if (!Number.isInteger(i.nonce) || i.nonce < 0) throw new BurialError("Bad nonce.", "BAD_NONCE");
    if (typeof i.value !== "string" || i.value.length === 0 || i.value.length > 600) throw new BurialError("Bad value.", "BAD_VALUE");
    if (typeof i.signature !== "string" || i.signature.length > 200) throw new BurialError("Bad signature.", "BAD_SIGNATURE");
    if (i.action === "exhume_bones" && !/^[1-9]\d{0,30}$/.test(i.value)) throw new BurialError("Bad amount.", "BAD_VALUE");

    const g = await registry.grave(i.graveId);
    if (!g) throw new BurialError("Grave not found.", "NOT_FOUND", 404);
    if (signerKind(g.owner_id) === "near") {
      throw new BurialError("This grave is owned by a named NEAR account, which calls the contract directly.", "NAMED_OWNER");
    }
    const [arg, msgField] = FIELD[i.action];
    const current = Number(await registry.nonce(g.owner_id));
    if (i.nonce !== current) throw new BurialError("That signature was already used. Sign again.", "STALE_NONCE");
    const message = actionMessage(i.action, i.graveId, [[msgField, i.value]], i.nonce);
    if (!(await walletSignatureValid(g.owner_id, message, i.signature))) {
      throw new BurialError("The signature doesn't match this grave's owner.", "BAD_SIGNATURE");
    }

    try {
      const res = await callContractRaw(i.action, { grave_id: i.graveId, [arg]: i.value, auth: { nonce: i.nonce, signature: i.signature } }, 50);
      if (res.failure) throw new Error(JSON.stringify(res.failure));
      return ok({ nearTx: res.hash, events: parseEvents(res.logs).map((e) => e.event) });
    } catch (e) {
      const m = (e as Error).message ?? "";
      const reason = /invalid owner signature/.test(m)
        ? "The signature doesn't match this grave's owner."
        : /stale or reused signature nonce/.test(m)
          ? "That signature was already used. Sign again."
          : /epitaph is too long/.test(m)
            ? "Epitaphs are limited to 140 characters."
            : /cannot transfer to the current owner/.test(m)
              ? "That account already owns this grave."
              : /not enough BONES/.test(m)
                ? "The grave doesn't hold that many BONES."
                : "NEAR rejected the action.";
      throw new BurialError(reason, "REJECTED", 400);
    }
  } catch (e) {
    return fail(e);
  }
}
