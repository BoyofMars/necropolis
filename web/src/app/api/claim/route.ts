import { claimShare } from "@/server/payouts";
import { body, fail, ok } from "@/server/respond";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { graveId, eventId } = await body<{ graveId: number; eventId: number }>(req);
    return ok(await claimShare(Number(graveId), Number(eventId)));
  } catch (e) {
    return fail(e);
  }
}
