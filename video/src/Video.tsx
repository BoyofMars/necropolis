import type { CSSProperties, FC } from "react";
import { Ease, clamp, lerp, ramp } from "./kit";
import { Bury } from "./scenes/bury";
import { Cold, Logo, Promise, Stat } from "./scenes/intro";
import { Near } from "./scenes/near";
import { Cta, Montage, Proof } from "./scenes/outro";
import { Accounts, Bones, Rise } from "./scenes/story";
import type { SceneProps } from "./scenes/types";
import { FPS, SCENES, type SceneName, bar } from "./timeline";
import { Background, C, F, Grain, type Palette, Vignette, fill } from "./ui";

type Transition = "cut" | "flash" | "zoom" | "wipe" | "iris" | "glitch";

const LIST: { name: SceneName; Comp: FC<SceneProps>; palette: Palette; intro: Transition }[] = [
  { name: "cold", Comp: Cold, palette: ["#2a0b0b", "#0d1a16", "#120c0a"], intro: "cut" },
  { name: "stat", Comp: Stat, palette: ["#3a1606", "#24090f", "#140c08"], intro: "glitch" },
  { name: "logo", Comp: Logo, palette: [C.emberDeep, C.magenta, C.violet], intro: "flash" },
  { name: "promise", Comp: Promise, palette: [C.violet, C.emberDeep, "#0b3b2c"], intro: "zoom" },
  { name: "bury", Comp: Bury, palette: ["#5a2a8c", C.emberDeep, "#0e4a5a"], intro: "flash" },
  { name: "near", Comp: Near, palette: ["#0c6b52", C.violet, "#123a6b"], intro: "wipe" },
  { name: "rise", Comp: Rise, palette: [C.emberDeep, "#0c6b52", C.magenta], intro: "zoom" },
  { name: "bones", Comp: Bones, palette: ["#8a5a12", C.violet, "#3a1206"], intro: "iris" },
  { name: "accounts", Comp: Accounts, palette: [C.violet, "#123a6b", C.magenta], intro: "wipe" },
  { name: "proof", Comp: Proof, palette: ["#0c6b52", "#0e4a5a", C.violet], intro: "flash" },
  { name: "montage", Comp: Montage, palette: [C.magenta, C.emberDeep, C.violet], intro: "flash" },
  { name: "cta", Comp: Cta, palette: [C.emberDeep, "#0c6b52", C.violet], intro: "zoom" },
];

const PRE: Record<Transition, number> = { cut: 0, flash: 0, glitch: 0, zoom: 0.35, wipe: 0.3, iris: 0.1 };
const POST: Record<Transition, number> = { cut: 0, flash: 0, glitch: 0, zoom: 0.35, wipe: 0.35, iris: 0.55 };

/** How a scene looks while it enters (boundary B) or leaves (the next scene's boundary). */
function enterStyle(kind: Transition, T: number, B: number): CSSProperties {
  switch (kind) {
    case "zoom": {
      const k = ramp(T, B - 0.1, B + 0.35, Ease.outCubic);
      return { opacity: k, transform: `scale(${lerp(0.72, 1, k)})`, filter: k < 1 ? `blur(${(1 - k) * 14}px)` : undefined };
    }
    case "wipe": {
      const k = ramp(T, B - 0.3, B + 0.35, Ease.inOutCubic);
      const x = lerp(-15, 115, k);
      return { clipPath: `polygon(0 0, ${x}% 0, ${x - 15}% 100%, 0 100%)` };
    }
    case "iris": {
      const k = ramp(T, B - 0.1, B + 0.55, Ease.inOutCubic);
      return { clipPath: `circle(${lerp(0, 120, k)}% at 50% 50%)` };
    }
    case "glitch": {
      const g = 1 - ramp(T, B, B + 0.22, Ease.linear);
      const j = Math.sin(T * 400) * 26 * g;
      return g > 0 ? { transform: `translateX(${j}px)`, filter: `hue-rotate(${g * 90}deg) saturate(${1 + g * 2})` } : {};
    }
    default:
      return {};
  }
}

function leaveStyle(kind: Transition, T: number, B: number): CSSProperties {
  switch (kind) {
    case "zoom": {
      const k = ramp(T, B - 0.35, B + 0.1, Ease.inCubic);
      return { opacity: 1 - k, transform: `scale(${lerp(1, 1.7, k)})`, filter: k > 0 ? `blur(${k * 18}px)` : undefined };
    }
    case "wipe": {
      const k = ramp(T, B - 0.3, B + 0.35, Ease.inOutCubic);
      return { transform: `translateX(${-k * 12}%)`, opacity: 1 - k * 0.6 };
    }
    default:
      return {};
  }
}

/** A white flash at a boundary, peaking on the beat. */
function flashAt(T: number, B: number) {
  if (T < B - 0.07 || T > B + 0.5) return 0;
  return T < B ? ramp(T, B - 0.07, B, Ease.inQuad) : 1 - ramp(T, B, B + 0.5, Ease.outCubic);
}

export function Video({ frame }: { frame: number }) {
  const T = frame / FPS;
  const layers = [];
  const bgs = [];
  let flash = 0;
  for (let i = 0; i < LIST.length; i++) {
    const s = LIST[i];
    const [b0, b1] = SCENES[s.name];
    const S = bar(b0);
    const E = bar(b1);
    const next = LIST[i + 1];
    const outKind: Transition = next ? next.intro : "cut";
    if (s.intro === "flash") flash = Math.max(flash, flashAt(T, S));
    const visible = T >= S - PRE[s.intro] && T < E + POST[outKind];
    // Backgrounds cross-fade over half a second around each boundary.
    const bgo = Math.min(ramp(T, S - 0.25, S + 0.25, Ease.inOutQuad), next ? 1 - ramp(T, E - 0.25, E + 0.25, Ease.inOutQuad) : 1);
    if (bgo > 0.001) bgs.push(<div key={`bg${s.name}`} style={{ ...fill, opacity: i === 0 ? clamp(bgo + (T < S ? 1 : 0)) : bgo }}><Background T={T} palette={s.palette} intensity={s.name === "cold" || s.name === "stat" ? 0.8 : 1} /></div>);
    if (!visible) continue;
    const st: CSSProperties = { ...fill, ...(T < S + POST[s.intro] ? enterStyle(s.intro, T, S) : {}), ...(T > E - PRE[outKind] ? leaveStyle(outKind, T, E) : {}) };
    layers.push(
      <div key={s.name} style={st}>
        <s.Comp t={T - S} d={E - S} T={T} frame={frame} />
      </div>,
    );
  }
  return (
    <div style={{ position: "relative", width: 1920, height: 1080, overflow: "hidden", background: C.bg, color: C.ink, fontFamily: F.sans }}>
      {bgs}
      {layers}
      <Vignette strength={0.7} />
      <Grain frame={frame} />
      {flash > 0 && <div style={{ ...fill, background: "#fff7ea", opacity: flash * 0.92 }} />}
    </div>
  );
}
