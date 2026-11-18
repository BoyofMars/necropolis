import { CHAINS, TokenIdentityError, detectFamily, isChainId, type ChainId } from "@/core/chains";
import { NETWORK } from "@/core/near";
import { scanWallet } from "@/server/dossier";
import { fail, ok } from "@/server/respond";

export const maxDuration = 45;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const address = (url.searchParams.get("address") ?? "").trim();
    const family = detectFamily(address);
    if (!family) throw new TokenIdentityError("That doesn't look like a Solana or Base wallet address.", "INVALID_ADDRESS");
    const requested = url.searchParams.get("chain");
    let chain: ChainId;
    if (requested && isChainId(requested)) {
      chain = requested;
      if (CHAINS[chain].family !== family)
        throw new TokenIdentityError(
          family === "evm" ? "That's an EVM address; switch to Base to scan it." : "That's a Solana address; switch to Solana to scan it.",
          "CHAIN_MISMATCH",
        );
    } else {
      chain = family === "solana" ? (NETWORK === "mainnet" ? "sol" : "sol") : "base";
    }
    // ?fresh=… (the burial page, right after the faucet): no cache anywhere, or new bags stay hidden for up to 100 s.
    const fresh = url.searchParams.has("fresh");
    const result = await scanWallet(chain, family === "evm" ? address.toLowerCase() : address, { fresh });
    return ok(result, fresh ? 0 : 20);
  } catch (e) {
    return fail(e);
  }
}
