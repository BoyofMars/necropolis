import { detectFamily } from "@/core/chains";
import { TEST_BAGS } from "@/core/testnet";
import { dexPairsForTokens, dexSearch, summarisePairs } from "@/server/providers";
import { fail, ok } from "@/server/respond";

export async function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) return ok({ results: [] });
    const family = detectFamily(q);
    const tests = TEST_BAGS.filter((b) => b.symbol.toLowerCase().includes(q.toLowerCase().replace("$", "")) || b.address === q).map((b) => ({
      chain: b.chain,
      address: b.address,
      symbol: b.symbol,
      name: b.name,
      image: null,
      liquidityUsd: null,
      testBag: true,
    }));
    let pairs = family
      ? [...(await dexPairsForTokens(family === "evm" ? "base" : "sol", [q])).values()].flat()
      : await dexSearch(q.replace(/^\$/, ""));
    pairs = pairs.slice(0, 40);
    const byToken = new Map<string, typeof pairs>();
    for (const p of pairs) {
      const key = `${p.chainId}:${p.baseToken.address}`;
      byToken.set(key, [...(byToken.get(key) ?? []), p]);
    }
    const results = [...byToken.entries()]
      .map(([key, ps]) => {
        const s = summarisePairs(ps);
        const [c] = key.split(":");
        return {
          chain: c === "solana" ? "sol" : "base",
          address: c === "base" ? ps[0].baseToken.address.toLowerCase() : ps[0].baseToken.address,
          symbol: ps[0].baseToken.symbol,
          name: ps[0].baseToken.name,
          image: s.top?.info?.imageUrl ?? null,
          liquidityUsd: s.liq,
          testBag: false,
        };
      })
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, 12);
    return ok({ results: [...tests, ...results] }, 60);
  } catch (e) {
    return fail(e);
  }
}
