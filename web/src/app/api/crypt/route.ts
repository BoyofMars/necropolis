/**
 * The crypt: a page only a grave's current holder can open.
 *
 * The holder's wallet signs a short, time-boxed message. We read the grave's
 * owner from NEAR at a fixed final block and check the signature against that
 * owner, so access follows the NFT: the moment a grave changes hands, the old
 * holder's wallet stops opening it (their signature no longer matches the
 * owner on chain). Nothing is cached; every visit is checked again.
 */
import { CONTRACT_ID, NEAR_RPC, cryptMessage, graveAccountId, registry, type GraveEventJson, type GraveJson } from "@/core/near";
import { signerKind } from "@/lib/ownerAction";
import { BurialError } from "@/server/burial";
import { body, fail, ok } from "@/server/respond";
import { walletSignatureValid } from "@/server/walletsig";

export const maxDuration = 20;

const WINDOW_SECS = 600;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "crypt", method, params }),
    cache: "no-store",
  });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (!j.result) throw new BurialError("Couldn't reach NEAR. Try again.", "RPC", 502);
  return j.result;
}

/** get_grave at an exact block, so the answer is pinned to that block. */
async function graveAt(id: number, height: number): Promise<GraveJson | null> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    block_id: height,
    account_id: CONTRACT_ID,
    method_name: "get_grave",
    args_base64: Buffer.from(JSON.stringify({ grave_id: id })).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString("utf8")) as GraveJson | null;
}

function statement(history: GraveEventJson[]) {
  const earned: Record<string, bigint> = {};
  const bones = { minted: 0n, exhumed: 0n, burned: 0n };
  const holders: string[] = [];
  for (const h of history) {
    const amt = BigInt(h.amount ?? "0");
    if ((h.kind === "earned" || h.kind === "raised") && h.symbol) earned[h.symbol] = (earned[h.symbol] ?? 0n) + amt;
    if (h.kind === "bones_minted") bones.minted += amt;
    if (h.kind === "bones_exhumed") bones.exhumed += amt;
    if (h.kind === "bones_burned") bones.burned += amt;
    if ((h.kind === "buried" || h.kind === "transferred") && h.account && holders.at(-1) !== h.account) holders.push(h.account);
  }
  return {
    earned: Object.entries(earned).map(([symbol, amount]) => ({ symbol, amount: amount.toString() })),
    bones: { minted: bones.minted.toString(), exhumed: bones.exhumed.toString(), burned: bones.burned.toString() },
    holders,
  };
}

export async function POST(req: Request) {
  try {
    const i = await body<{ graveId: number; issued: number; signature: string; signer?: string }>(req);
    if (!Number.isInteger(i.graveId) || i.graveId < 0) throw new BurialError("Bad grave id.", "BAD_GRAVE");
    if (!Number.isInteger(i.issued)) throw new BurialError("Bad timestamp.", "BAD_ISSUED");
    if (typeof i.signature !== "string" || i.signature.length > 200) throw new BurialError("Bad signature.", "BAD_SIGNATURE");
    if (Math.abs(Math.floor(Date.now() / 1000) - i.issued) > WINDOW_SECS) {
      throw new BurialError("That signature has expired. Sign again.", "EXPIRED", 401);
    }

    const block = await rpc<{ header: { height: number; hash: string; timestamp_nanosec: string } }>("block", { finality: "final" });
    const g = await graveAt(i.graveId, block.header.height);
    if (!g) throw new BurialError("Grave not found.", "NOT_FOUND", 404);
    if (signerKind(g.owner_id) === "near") {
      throw new BurialError("This grave is held by a named NEAR account; its crypt opens from that account.", "NAMED_OWNER", 403);
    }

    const message = cryptMessage(i.graveId, i.issued);
    const history = await registry.graveHistory(i.graveId).catch(() => [] as GraveEventJson[]);
    if (!(await walletSignatureValid(g.owner_id, message, i.signature))) {
      const signer = typeof i.signer === "string" ? i.signer : "";
      const theirs = signer && signer !== g.owner_id && (await walletSignatureValid(signer, message, i.signature));
      const heldBefore = theirs && history.some((h) => (h.kind === "buried" || h.kind === "transferred") && h.account === signer);
      throw new BurialError(
        heldBefore
          ? "This wallet held the grave once. It was handed on, and the crypt went with it."
          : theirs
            ? "This wallet doesn't hold the grave. Only its current holder can open the crypt."
            : "The signature doesn't match this grave's holder.",
        "NOT_HOLDER",
        403,
      );
    }

    const account = graveAccountId(i.graveId);
    const inside = await registry.bonesBalance(account).catch(() => "0");
    return ok({
      graveId: i.graveId,
      holder: g.owner_id,
      account,
      checkedAt: { height: block.header.height, hash: block.header.hash, at: Math.floor(Number(block.header.timestamp_nanosec) / 1e9) },
      inside,
      history,
      statement: statement(history),
    });
  } catch (e) {
    return fail(e);
  }
}
