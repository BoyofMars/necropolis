import { prepareBurial, type PrepareInput } from "@/server/burial";
import { body, fail, ok } from "@/server/respond";

export const maxDuration = 45;

export async function POST(req: Request) {
  try {
    const input = await body<PrepareInput>(req);
    return ok(await prepareBurial(input));
  } catch (e) {
    return fail(e);
  }
}
