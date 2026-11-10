import type { ChainId } from "@/core/chains";
import { submitSolana } from "@/server/burial";
import { body, fail, ok } from "@/server/respond";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { chain, tx } = await body<{ chain: ChainId; tx: string }>(req);
    const signature = await submitSolana(chain, tx);
    return ok({ signature });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("Blockhash not found") || msg.includes("block height exceeded")) {
      return fail(Object.assign(new Error("The transaction expired before it was sent. Prepare it again."), { name: "Expired" }));
    }
    return fail(e);
  }
}
