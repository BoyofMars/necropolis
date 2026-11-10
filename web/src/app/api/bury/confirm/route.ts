import { confirmBurial, type ConfirmInput } from "@/server/burial";
import { body, fail, ok } from "@/server/respond";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const input = await body<ConfirmInput>(req);
    return ok(await confirmBurial(input));
  } catch (e) {
    return fail(e);
  }
}
