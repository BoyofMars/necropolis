import { ImageResponse } from "next/og";
import { CHAINS, detectFamily, shortAddress, type ChainId } from "@/core/chains";
import { leftLine, obituaryOf, risenLine, type ObituaryEntry } from "@/core/obituary";
import { scanWallet } from "@/server/dossier";
import { C, Frame, Wordmark, ogFonts } from "@/server/og";

export const maxDuration = 45;

/** One headstone. Coins that rose on Necropolis glow. */
function Stone({ e, rose }: { e: ObituaryEntry; rose?: boolean }) {
  const sym = `$${e.symbol.slice(0, 9)}`;
  const size = sym.length <= 6 ? 30 : sym.length <= 8 ? 24 : 20;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 150,
        height: 150,
        paddingTop: 22,
        border: `1.5px solid ${rose ? C.ember : C.line}`,
        borderBottom: "none",
        borderRadius: "75px 75px 0 0",
        background: rose ? "linear-gradient(180deg, rgba(240,166,60,.22), rgba(240,166,60,.04))" : C.loam2,
      }}
    >
      <span style={{ fontSize: 13, letterSpacing: 4, color: rose ? C.ember : C.bone3 }}>{rose ? "ROSE" : "R.I.P."}</span>
      <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: size, color: rose ? C.emberBright : C.bone, marginTop: 8, height: 38, alignItems: "center", display: "flex" }}>
        {sym}
      </span>
      <span style={{ fontSize: 15, color: rose ? C.ember : e.diagnosis.condition === "DEAD" ? C.dead : C.critical, marginTop: 2 }}>
        {rose ? "came back" : e.diagnosis.deathScore !== undefined ? `${e.diagnosis.deathScore}/100` : e.diagnosis.condition.toLowerCase()}
      </span>
    </div>
  );
}

/** A wallet's obituary as a share card: one headstone per departed coin. */
export async function GET(_req: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address: raw } = await ctx.params;
  const address = decodeURIComponent(raw);
  const fonts = await ogFonts();
  const valid = chain in CHAINS && detectFamily(address) === CHAINS[chain as ChainId].family;
  try {
    if (!valid) throw new Error("bad address");
    const scan = await scanWallet(chain as ChainId, address);
    const o = obituaryOf(address, scan.entries);
    const rose = o.risen.slice(0, 3);
    const stones = o.departed.slice(0, 6 - rose.length);
    const more = o.departed.length - stones.length;
    const footer = risenLine(o) ?? (stones.length > 0 ? o.epitaph : " ");
    return new ImageResponse(
      (
        <Frame glow={o.departed.length === 0}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 20, letterSpacing: 8, color: C.bone3 }}>OBITUARY</span>
            <Wordmark />
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
            <span style={{ fontSize: 24, color: C.bone3 }}>
              The bags of {shortAddress(address, 5, 5)} · {CHAINS[chain as ChainId].name}
            </span>
            <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 92, lineHeight: 1.05, color: C.bone, marginTop: 6 }}>{o.headline}</span>
            <span style={{ fontFamily: "Cormorant", fontStyle: "italic", fontSize: 36, color: C.ember, marginTop: 6 }}>{leftLine(o)}</span>
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: "auto", alignItems: "flex-end" }}>
            {stones.map((s) => (
              <Stone key={s.address} e={s} />
            ))}
            {more > 0 && <span style={{ fontFamily: "Cormorant", fontSize: 34, color: C.bone3, marginLeft: 4, marginBottom: 50 }}>+{more}</span>}
            {rose.map((s) => (
              <Stone key={s.address} e={s} rose />
            ))}
            {stones.length === 0 && rose.length === 0 && (
              <span style={{ fontFamily: "Cormorant", fontStyle: "italic", fontSize: 40, color: C.bone2 }}>{o.epitaph}</span>
            )}
          </div>
          <div style={{ display: "flex", height: 1.5, background: C.line }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, fontSize: 19, color: C.bone3 }}>
            <span style={{ fontFamily: "Cormorant", fontStyle: "italic", fontSize: 24, color: o.risen.length > 0 ? C.ember : C.bone2 }}>{footer}</span>
            <span>Who died in your wallet? · Bury your bag. Keep the upside.</span>
          </div>
        </Frame>
      ),
      { width: 1200, height: 630, fonts, headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" } },
    );
  } catch {
    return new ImageResponse(
      (
        <Frame>
          <Wordmark />
          <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 96, color: C.bone, marginTop: 120 }}>Who died in your wallet?</span>
        </Frame>
      ),
      { width: 1200, height: 630, fonts },
    );
  }
}
