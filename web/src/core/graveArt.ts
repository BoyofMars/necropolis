/**
 * Generative headstone for a grave NFT. Pure function of on-chain state, so
 * the NFT's image evolves with its plot: fresh → forgotten (moss) → stirring
 * (ember light through cracks) → risen (gilded, open).
 */
import type { GraveJson, PlotJson } from "./near";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}

export type GraveStage = "fresh" | "forgotten" | "stirring" | "risen";

export function graveStage(g: Pick<GraveJson, "buried_at" | "raised">, plot?: Pick<PlotJson, "state"> | null, now = Date.now() / 1000): GraveStage {
  if (plot?.state.kind === "RISEN" || g.raised) return "risen";
  if (plot?.state.kind === "STIRRING") return "stirring";
  return now - Number(g.buried_at) > 7 * 86_400 ? "forgotten" : "fresh";
}

function fmtAmount(raw: string, decimals: number) {
  const n = Number(raw) / 10 ** decimals;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Word-wrap an epitaph into at most 3 lines. */
function wrap(text: string, max = 26): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 3);
}

export function graveSvg(g: GraveJson, plot: PlotJson | null, now = Date.now() / 1000): string {
  const stage = graveStage(g, plot, now);
  const r = rand(g.id * 7919 + 13);
  const days = Math.max(0, Math.floor((now - Number(g.buried_at)) / 86_400));
  const symbol = esc(plot?.symbol ?? "UNKNOWN");
  const chain = g.chain.startsWith("sol") ? "SOLANA" : "BASE";
  const no = String(g.id).padStart(6, "0");
  const date = new Date(Number(g.buried_at) * 1000).toISOString().slice(0, 10);
  const stone = stage === "risen" ? "#2a241a" : "#24211d";
  const ink = stage === "risen" ? "#ffcd7d" : "#d9d1c0";
  const sub = stage === "risen" ? "#f0a63c" : "#8e8676";

  // moss grows with time spent resting
  const mossCount = stage === "fresh" ? 0 : Math.min(60, 8 + days * 2);
  let moss = "";
  for (let i = 0; i < mossCount; i++) {
    const x = 120 + r() * 360;
    const y = 600 - Math.pow(r(), 1.8) * 360;
    moss += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.2 + r() * 3.2).toFixed(1)}" fill="${r() > 0.5 ? "#4f5a3a" : "#3e4a31"}" opacity="${(0.35 + r() * 0.5).toFixed(2)}"/>`;
  }

  // cracks with ember light when stirring / risen
  let cracks = "";
  if (stage === "stirring" || stage === "risen") {
    for (let k = 0; k < 3; k++) {
      let x = 200 + r() * 200;
      let y = 600;
      let d = `M${x.toFixed(1)} ${y}`;
      for (let s = 0; s < 6; s++) {
        x += (r() - 0.5) * 50;
        y -= 30 + r() * 30;
        d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      cracks += `<path d="${d}" stroke="#f0a63c" stroke-width="${stage === "risen" ? 3 : 2}" fill="none" filter="url(#glow)" opacity="${stage === "risen" ? 0.95 : 0.8}"/>`;
    }
  }

  const epitaph = g.epitaph ? wrap(g.epitaph) : [];
  const epitaphSvg = epitaph
    .map((l, i) => `<text x="300" y="${468 + i * 26}" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="20" fill="${sub}">${i === 0 ? "“" : ""}${esc(l)}${i === epitaph.length - 1 ? "”" : ""}</text>`)
    .join("");

  const label = { fresh: "FRESHLY BURIED", forgotten: `RESTING · ${days} DAYS`, stirring: "STIRRING", risen: "RISEN" }[stage];
  const pulse =
    stage === "stirring"
      ? `<path d="M160 560 h80 l10 -18 l14 36 l12 -50 l14 32 h150" stroke="#f0a63c" stroke-width="2.5" fill="none" filter="url(#glow)"/>`
      : stage === "risen"
        ? `<path d="M140 560 h40 l10 -24 l14 48 l12 -70 l14 46 h40 l10 -24 l14 48 l12 -70 l14 46 h56" stroke="#ffcd7d" stroke-width="2.5" fill="none" filter="url(#glow)"/>`
        : `<path d="M160 560 h280" stroke="#4a443b" stroke-width="2" fill="none"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 720" width="600" height="720">
<defs>
  <radialGradient id="sky" cx="50%" cy="20%" r="80%"><stop offset="0" stop-color="${stage === "risen" ? "#3a2a12" : "#1a1815"}"/><stop offset="1" stop-color="#0c0b0a"/></radialGradient>
  <linearGradient id="stone" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${stone}"/><stop offset="1" stop-color="#15130f"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .07 0"/></filter>
</defs>
<rect width="600" height="720" fill="url(#sky)"/>
${stage === "risen" ? `<ellipse cx="300" cy="640" rx="260" ry="40" fill="#f0a63c" opacity=".18" filter="url(#glow)"/>` : ""}
<path d="M110 640 V240 A190 190 0 0 1 490 240 V640 Z" fill="url(#stone)" stroke="${stage === "risen" ? "#a8681c" : "#46413a"}" stroke-width="3"/>
<path d="M110 640 V240 A190 190 0 0 1 490 240 V640 Z" filter="url(#grain)"/>
${moss}
${cracks}
<text x="300" y="168" text-anchor="middle" font-family="Georgia, serif" font-size="18" letter-spacing="6" fill="${sub}">HERE LIES</text>
<text x="300" y="250" text-anchor="middle" font-family="Georgia, serif" font-size="58" font-weight="600" fill="${ink}">$${symbol}</text>
<text x="300" y="300" text-anchor="middle" font-family="Georgia, serif" font-size="24" fill="${ink}">Nº ${no}</text>
<line x1="210" x2="390" y1="330" y2="330" stroke="${sub}" stroke-opacity=".5"/>
<text x="300" y="372" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="${ink}">${esc(fmtAmount(g.amount, g.decimals))} tokens</text>
<text x="300" y="404" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" letter-spacing="3" fill="${sub}">${chain} · ${date}</text>
${epitaphSvg}
${pulse}
<rect x="0" y="640" width="600" height="80" fill="#0c0b0a"/>
<path d="M0 640 Q150 628 300 640 T600 640 V660 H0Z" fill="#14120f"/>
<text x="300" y="690" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" letter-spacing="4" fill="${stage === "stirring" || stage === "risen" ? "#f0a63c" : "#6b6458"}">${label}</text>
</svg>`;
}
