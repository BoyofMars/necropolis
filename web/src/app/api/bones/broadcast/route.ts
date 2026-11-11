/**
 * Broadcast a $BONES claim payout that the MPC network has already signed.
 * The recipient and amount are fixed inside the signed transaction, so anyone
 * may broadcast it; this just saves the holder from doing it by hand.
 */
import { BurialError } from "@/server/burial";
import { broadcastSigned } from "@/server/payouts";
import { body, fail, ok } from "@/server/respond";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { eventId, holder } = await body<{ eventId: number; holder: string }>(req);
    if (!Number.isInteger(eventId) || eventId < 0) throw new BurialError("Bad event id.", "BAD_EVENT");
    if (typeof holder !== "string" || holder.length < 2 || holder.length > 64) throw new BurialError("Bad holder.", "BAD_HOLDER");
    const { txs } = await broadcastSigned(`bones:${eventId}:${holder}`);
    return ok({ txs });
  } catch (e) {
    return fail(e);
  }
}
