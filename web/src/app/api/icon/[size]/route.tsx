import { ImageResponse } from "next/og";

/** PNG app icons for the PWA manifest and iOS (generated from the brand mark). */
export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const s = Math.min(1024, Math.max(32, Number.parseInt(size, 10) || 192));
  const pad = Math.round(s * 0.18);
  return new ImageResponse(
    (
      <div style={{ width: s, height: s, display: "flex", alignItems: "center", justifyContent: "center", background: "#0c0b0a" }}>
        <svg width={s - pad * 2} height={s - pad * 2} viewBox="0 0 32 32">
          <path d="M8 27V14a8 8 0 0 1 16 0v13" fill="none" stroke="#ece6d8" strokeWidth="1.8" />
          <path d="M5 27.5h22" stroke="#8e8676" strokeWidth="1.4" />
          <path d="M10.5 20h3l1.4-3.2 2.2 6.4 1.6-3.2h2.8" fill="none" stroke="#f0a63c" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { width: s, height: s, headers: { "cache-control": "public, max-age=31536000, immutable" } },
  );
}
