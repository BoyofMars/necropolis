import { ImageResponse } from "next/og";
import { graveStage } from "@/core/graveArt";
import { registry } from "@/core/near";
import { C, Flatline, Frame, Wordmark, ogFonts } from "@/server/og";

/** Share card for a grave: "Here lies…", stirring, or risen. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const fonts = await ogFonts();
  const g = await registry.grave(Number(id)).catch(() => null);
  const plot = g ? await registry.plot(g.plot_id).catch(() => null) : null;
  const no = `Nº ${String(id).padStart(6, "0")}`;
  if (!g) {
    return new ImageResponse(
      (
        <Frame>
          <Wordmark />
          <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 110, color: C.bone, marginTop: 110 }}>{no}</span>
          <span style={{ fontSize: 28, color: C.bone3 }}>An unclaimed plot.</span>
        </Frame>
      ),
      { width: 1200, height: 630, fonts },
    );
  }
  const stage = graveStage(g, plot);
  const glow = stage === "stirring" || stage === "risen";
  const amount = Number(g.amount) / 10 ** g.decimals;
  const amt = amount >= 1e9 ? `${(amount / 1e9).toFixed(2)}B` : amount >= 1e6 ? `${(amount / 1e6).toFixed(2)}M` : amount >= 1e3 ? `${(amount / 1e3).toFixed(1)}K` : amount.toFixed(2);
  const headline = stage === "risen" ? "HAS RISEN" : stage === "stirring" ? "IS STIRRING" : "HERE LIES";
  return new ImageResponse(
    (
      <Frame glow={glow}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 20, letterSpacing: 8, color: glow ? C.ember : C.bone3 }}>{headline}</span>
          <Wordmark />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 36, marginTop: 30 }}>
          <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 140, lineHeight: 1, color: glow ? C.emberBright : C.bone }}>${(plot?.symbol ?? "???").slice(0, 10)}</span>
          <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 48, color: C.bone2, marginBottom: 14 }}>{no}</span>
        </div>
        <span style={{ fontSize: 30, color: C.bone2, marginTop: 14 }}>
          {amt} tokens buried on {g.chain.startsWith("sol") ? "Solana" : "Base"}, {new Date(Number(g.buried_at) * 1000).toISOString().slice(0, 10)}
        </span>
        {g.epitaph && (
          <span style={{ fontFamily: "Cormorant", fontStyle: "italic", fontSize: 40, color: C.bone3, marginTop: 18 }}>
            “{g.epitaph.slice(0, 80)}”
          </span>
        )}
        <div style={{ display: "flex", marginTop: "auto" }}>
          <Flatline color={glow ? C.ember : C.bone3} alive={glow} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 18, color: C.bone3 }}>
          <span>Verified by NEAR · no bridge</span>
          <span>If it ever comes back, it comes back to its owner.</span>
        </div>
      </Frame>
    ),
    { width: 1200, height: 630, fonts, headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=600" } },
  );
}
