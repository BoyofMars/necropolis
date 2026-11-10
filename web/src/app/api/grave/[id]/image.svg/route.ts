import { graveSvg } from "@/core/graveArt";
import { registry } from "@/core/near";

/** NEP-177 media for grave NFTs: a live image derived from on-chain state. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n < 0) return new Response("bad grave id", { status: 400 });
  const g = await registry.grave(n).catch(() => null);
  if (!g) return new Response("grave not found", { status: 404 });
  const plot = await registry.plot(g.plot_id).catch(() => null);
  return new Response(graveSvg(g, plot), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
