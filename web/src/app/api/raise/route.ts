import { raiseGrave } from "@/server/payouts";
import { body, fail, ok } from "@/server/respond";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { graveId } = await body<{ graveId: number }>(req);
    return ok(await raiseGrave(Number(graveId)));
  } catch (e) {
    return fail(e);
  }
}
