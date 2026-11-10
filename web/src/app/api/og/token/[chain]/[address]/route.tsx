import { ImageResponse } from "next/og";
import { CHAINS, shortAddress, type ChainId } from "@/core/chains";
import { diagnose } from "@/core/death";
import { getDossier } from "@/server/dossier";
import { C, Flatline, Frame, Wordmark, ogFonts } from "@/server/og";

export const maxDuration = 30;

const usd = (n?: number) =>
  n === undefined ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;

/** Death certificate share card for a token. */
export async function GET(_req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await ctx.params;
  const fonts = await ogFonts();
  try {
    const dossier = await getDossier(chain as ChainId, decodeURIComponent(address), { history: true });
    const d = diagnose(dossier);
    const p = dossier.profile;
    const dead = d.condition === "DEAD" || d.condition === "CRITICAL";
    const color = d.condition === "DEAD" ? C.dead : d.condition === "CRITICAL" ? C.critical : C.bone2;
    return new ImageResponse(
      (
        <Frame>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 20, letterSpacing: 8, color: C.bone3 }}>{dead ? "CERTIFICATE OF DEATH" : "MEDICAL REPORT"}</span>
            <Wordmark />
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
            <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 132, lineHeight: 1, color: C.bone }}>${p.symbol.slice(0, 12)}</span>
            <span style={{ fontFamily: "Cormorant", fontStyle: "italic", fontSize: 44, color, marginTop: 10 }}>{d.headline}</span>
          </div>
          <div style={{ display: "flex", marginTop: 28 }}>
            <Flatline color={color} alive={!dead} />
          </div>
          <div style={{ display: "flex", gap: 56, marginTop: "auto" }}>
            {[
              ["DEATH SCORE", d.deathScore !== undefined ? `${d.deathScore}/100` : "—"],
              ["CAUSE", dead ? d.cause.title : "—"],
              ["LIQUIDITY", usd(dossier.vitals.liquidityUsd?.value)],
              ["FROM PEAK", d.drawdownFromAth !== undefined ? `-${(d.drawdownFromAth * 100).toFixed(1)}%` : "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 15, letterSpacing: 4, color: C.bone3 }}>{k}</span>
                <span style={{ fontSize: 30, color: C.bone, marginTop: 6 }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 26, fontSize: 18, color: C.bone3 }}>
            <span>{CHAINS[p.ref.chain].name} · {shortAddress(p.ref.address, 6, 6)}</span>
            <span>Bury your bag. Keep the upside.</span>
          </div>
        </Frame>
      ),
      { width: 1200, height: 630, fonts, headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return new ImageResponse(
      (
        <Frame>
          <Wordmark />
          <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 96, color: C.bone, marginTop: 120 }}>An autopsy awaits.</span>
        </Frame>
      ),
      { width: 1200, height: 630, fonts },
    );
  }
}
