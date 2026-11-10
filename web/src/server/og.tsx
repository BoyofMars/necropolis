import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";

/** Font files live next to the OG routes; find them whatever the server's cwd is. */
function fontDir(): string {
  const candidates = [
    join(process.cwd(), "src/app/api/og/fonts"),
    join(process.cwd(), "web/src/app/api/og/fonts"),
    join(process.cwd(), ".next/server/src/app/api/og/fonts"),
  ];
  return candidates.find((d) => existsSync(join(d, "hanken-600.woff"))) ?? candidates[0];
}

let fonts: Promise<{ name: string; data: Buffer; weight: 500 | 600; style: "normal" | "italic" }[]> | null = null;

export function ogFonts() {
  const dir = fontDir();
  fonts ??= Promise.all([
    readFile(join(dir, "cormorant-600.woff")).then((data) => ({ name: "Cormorant", data, weight: 600 as const, style: "normal" as const })),
    readFile(join(dir, "cormorant-500-italic.woff")).then((data) => ({ name: "Cormorant", data, weight: 500 as const, style: "italic" as const })),
    readFile(join(dir, "hanken-600.woff")).then((data) => ({ name: "Hanken", data, weight: 600 as const, style: "normal" as const })),
  ]).catch((e) => {
    fonts = null;
    throw e;
  });
  return fonts;
}

export const C = {
  loam: "#0c0b0a",
  loam2: "#191714",
  line: "#2c2924",
  bone: "#ece6d8",
  bone2: "#bdb5a4",
  bone3: "#8e8676",
  ember: "#f0a63c",
  emberBright: "#ffcd7d",
  dead: "#8c867c",
  critical: "#c98472",
};

/** Certificate frame shared by every share card. */
export function Frame({ children, glow }: { children: ReactNode; glow?: boolean }) {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        background: glow ? "radial-gradient(70% 90% at 30% 110%, rgba(240,166,60,.28), #0c0b0a 70%)" : C.loam,
        padding: 28,
        fontFamily: "Hanken",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", border: `1.5px solid ${C.line}`, borderRadius: 18, padding: "44px 56px" }}>
        {children}
      </div>
    </div>
  );
}

export function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg width="34" height="34" viewBox="0 0 32 32">
        <path d="M8 27V14a8 8 0 0 1 16 0v13" fill="none" stroke={C.bone} strokeWidth="1.8" />
        <path d="M5 27.5h22" stroke={C.bone3} strokeWidth="1.4" />
        <path d="M10.5 20h3l1.4-3.2 2.2 6.4 1.6-3.2h2.8" fill="none" stroke={C.ember} strokeWidth="1.6" />
      </svg>
      <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 32, color: C.bone }}>Necropolis</span>
    </div>
  );
}

export function Flatline({ color = C.bone3, alive = false }: { color?: string; alive?: boolean }) {
  const d = alive
    ? "M0 30 H120 l10 -16 l12 32 l10 -46 l12 34 H300 l10 -16 l12 32 l10 -46 l12 34 H520 l10 -16 l12 32 l10 -46 l12 34 H1000"
    : "M0 30 H520 l8 -6 l8 10 l6 -4 H1000";
  return (
    <svg width="1000" height="60" viewBox="0 0 1000 60">
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" />
    </svg>
  );
}
