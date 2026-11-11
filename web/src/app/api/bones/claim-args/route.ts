/**
 * Chain fields for a claim a named NEAR holder sends from their own wallet
 * (`claim_bones` with a recipient). Returns only public fee-payer / gas data.
 */
import { claimChainArgs } from "@/server/payouts";
import { BurialError } from "@/server/burial";
import { body, fail, ok } from "@/server/respond";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { eventId } = await body<{ eventId: number }>(req);
    if (!Number.isInteger(eventId) || eventId < 0) throw new BurialError("Bad event id.", "BAD_EVENT");
    return ok(await claimChainArgs(eventId));
  } catch (e) {
    return fail(e);
  }
}
