/**
 * Claim a $BONES holder's share of a rising. Permissionless: the contract only
 * pays the holder's own key on the risen chain (for a grave's account, the
 * grave's current holder), so the Sexton can trigger it for anyone. The MPC
 * network signs from the ossuary address.
 */
import { graveIdOfAccount, registry } from "@/core/near";
import { signerKind } from "@/lib/ownerAction";
import { BurialError } from "@/server/burial";
import { claimBones } from "@/server/payouts";
import { body, fail, ok } from "@/server/respond";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { eventId, holder } = await body<{ eventId: number; holder: string }>(req);
    if (!Number.isInteger(eventId) || eventId < 0) throw new BurialError("Bad event id.", "BAD_EVENT");
    if (typeof holder !== "string") throw new BurialError("Bad holder.", "BAD_HOLDER");
    const graveId = graveIdOfAccount(holder);
    if (graveId === null && signerKind(holder) === "near") throw new BurialError("Holders claim with their Solana or EVM wallet.", "BAD_HOLDER");
    if (graveId !== null) {
      const g = await registry.grave(graveId);
      if (!g) throw new BurialError("Grave not found.", "NOT_FOUND", 404);
      if (signerKind(g.owner_id) === "near" && !g.payout_to) {
        throw new BurialError("This grave's holder hasn't set a payout address yet.", "NO_RECIPIENT", 409);
      }
    }
    const share = await registry.bonesShare(eventId, holder);
    if (!share) throw new BurialError("Resurrection event not found.", "NOT_FOUND", 404);
    if (share.claimed) throw new BurialError("Already claimed.", "CLAIMED", 409);
    if (!share.eligible) throw new BurialError(share.reason ?? "Nothing to claim.", "NOT_ELIGIBLE", 400);
    const ev = (await registry.events()).find((e) => e.id === eventId)!;
    if (!(await registry.gravesByPlot(ev.plot_id)).every((g) => g.raised)) {
      throw new BurialError(`$${ev.symbol}'s graves haven't been raised yet. The tithe reaches the ossuary when they are.`, "NOT_RAISED", 409);
    }
    return ok(await claimBones(eventId, holder));
  } catch (e) {
    return fail(e);
  }
}
