import { Ease, clamp, fmt, lerp, ramp, spring } from "../kit";
import { BEAT, CUES } from "../timeline";
import { C, Chip, ECG, Embers, F, FadeUp, Grad, Pop, Slam, Words, fill } from "../ui";
import type { SceneProps } from "./types";

const HEARTBEATS = [0.15, 0.95, 1.75, 2.6, 3.45];

export function Cold({ t }: SceneProps) {
  const dead = t >= CUES.flatline;
  const k = ramp(t, CUES.flatline, CUES.flatline + 0.25, Ease.outCubic);
  const shake = dead ? Math.exp(-(t - CUES.flatline) / 0.18) * Math.sin((t - CUES.flatline) * 90) * 14 : 0;
  const dim = 1 - ramp(t, 5.55, 6.0, Ease.inCubic);
  return (
    <div style={{ ...fill, opacity: dim }}>
      <div style={{ ...fill, background: `radial-gradient(60% 50% at 50% 70%, ${C.danger}${dead ? "30" : "00"}, transparent 70%)` }} />
      <div style={{ position: "absolute", left: 0, top: 560 }}>
        <ECG T={t} beats={HEARTBEATS} flatAt={CUES.flatline} color={dead ? C.danger : C.mint} height={300} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 210, textAlign: "center", fontFamily: F.sans, fontWeight: 800, fontSize: 104, letterSpacing: "-0.035em", color: C.ink, lineHeight: 1.04 }}>
        <Words text="Every memecoin you aped" t={t} at={0.2} out={3.75} />
        <Words text="is still in your wallet." t={t} at={1.85} out={3.8} color={C.ink2} />
      </div>
      {dead && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 170,
            textAlign: "center",
            fontFamily: F.display,
            fontStyle: "italic",
            fontWeight: 700,
            fontSize: 330,
            lineHeight: 1,
            color: C.danger,
            transform: `translateX(${shake}px) scale(${lerp(1.25, 1, k)})`,
            opacity: k,
            textShadow: `${-8 * (1 - k)}px 0 0 #00e5ff, ${8 * (1 - k)}px 0 0 #ff2a6d, 0 0 80px ${C.danger}88`,
          }}
        >
          Dead.
        </div>
      )}
    </div>
  );
}

export function Stat({ t }: SceneProps) {
  const out = ramp(t, 3.35, 4.0, Ease.inExpo);
  const up = ramp(t, 1.9, 2.5, Ease.inOutCubic);
  return (
    <div style={{ ...fill, transform: `scale(${1 - out * 0.45})`, filter: out > 0 ? `blur(${out * 16}px)` : undefined, opacity: 1 - out }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: lerp(250, 140, up), textAlign: "center", transform: `scale(${lerp(1, 0.72, up)})` }}>
        <Pop t={t} at={0} from={0.7}>
          <div style={{ fontFamily: F.sans, fontWeight: 900, fontSize: 230, letterSpacing: "-0.05em", lineHeight: 1 }}>
            <Grad from={C.emberHi} to={C.emberDeep}>
              {fmt(lerp(0, 11.6, ramp(t, 0, 1.3, Ease.outExpo)), 1)} million
            </Grad>
          </div>
        </Pop>
        <FadeUp t={t} at={0.35}>
          <div style={{ marginTop: 18, fontFamily: F.sans, fontWeight: 600, fontSize: 52, color: C.ink, letterSpacing: "-0.02em" }}>tokens stopped trading in 2025.</div>
        </FadeUp>
        <FadeUp t={t} at={0.8} out={1.9}>
          <div style={{ marginTop: 14, fontFamily: F.mono, fontSize: 24, color: C.ink3, letterSpacing: "0.12em", textTransform: "uppercase" }}>Source · CoinGecko</div>
        </FadeUp>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 600, textAlign: "center", fontFamily: F.sans, fontWeight: 800, fontSize: 92, letterSpacing: "-0.035em", color: C.ink }}>
        <Words
          text="Every tool treats them as trash."
          t={t}
          at={2.05}
          stagger={0.07}
          wordStyle={(i) => (i === 5 ? { color: C.danger, textDecoration: "line-through", textDecorationThickness: 8 } : undefined)}
        />
      </div>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 20, height: 20, marginLeft: -10, marginTop: -10, borderRadius: 99, background: "#fff", boxShadow: `0 0 ${lerp(0, 400, out)}px ${lerp(0, 160, out)}px ${C.emberHi}`, opacity: out }} />
    </div>
  );
}

/** An arched headstone, drawn on. */
function Stele({ t, at, color = C.ember }: { t: number; at: number; color?: string }) {
  const k = ramp(t, at, at + 0.9, Ease.inOutCubic);
  const len = 3000;
  return (
    <svg width="900" height="760" viewBox="0 0 900 760" style={{ position: "absolute", left: "50%", top: 130, marginLeft: -450, overflow: "visible" }}>
      <defs>
        <filter id="steleglow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="10" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M120 760 L120 330 C120 140 290 40 450 40 C610 40 780 140 780 330 L780 760"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeDasharray={len}
        strokeDashoffset={len * (1 - k)}
        filter="url(#steleglow)"
        opacity={0.85}
      />
    </svg>
  );
}

export function Logo({ t, T }: SceneProps) {
  const pulse = Math.exp(-((t % BEAT) / 0.12));
  return (
    <div style={fill}>
      <Embers T={T} count={70} burstAt={CUES.drop} seed="logo" color={C.emberHi} />
      <Stele t={t} at={0.05} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 360, transform: `scale(${1 + pulse * 0.012})` }}>
        <Slam
          text="NECROPOLIS"
          t={t}
          at={0.04}
          style={{ fontFamily: F.display, fontWeight: 700, fontSize: 196, letterSpacing: "0.08em", color: C.ink, textShadow: `0 0 60px ${C.ember}aa, 0 0 140px ${C.ember}55` }}
        />
        <div style={{ marginTop: 26, textAlign: "center", fontFamily: F.sans, fontWeight: 600, fontSize: 50, color: C.ink2, letterSpacing: "-0.01em" }}>
          <Words text="A graveyard for dead memecoins." t={t} at={1.0} stagger={0.07} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 790, display: "flex", justifyContent: "center", gap: 22 }}>
        <Pop t={t} at={2.0}>
          <Chip color={C.sol}>Solana</Chip>
        </Pop>
        <Pop t={t} at={2.25}>
          <Chip color={C.base}>Base</Chip>
        </Pop>
        <Pop t={t} at={2.5}>
          <Chip color={C.mint}>Verified by NEAR</Chip>
        </Pop>
      </div>
    </div>
  );
}

/** A coin that sinks into the ground, then rises glowing. */
function Coin({ t }: { t: number }) {
  const sink = ramp(t, 0.15, 1.0, Ease.inCubic);
  const rise = spring(t - 2.45, { stiffness: 120, damping: 11 });
  const y = lerp(-260, 150, sink) - rise * 330;
  const glow = clamp(rise);
  const spin = t * 2.2;
  return (
    <div style={{ position: "absolute", right: 250, top: 440, width: 300, height: 520 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 300, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            left: 60,
            top: 60 + y,
            width: 180,
            height: 180,
            borderRadius: 999,
            transform: `scaleX(${Math.abs(Math.cos(spin)) * 0.75 + 0.25})`,
            background: glow > 0.02 ? `radial-gradient(circle at 35% 30%, ${C.mintHi}, ${C.mint} 45%, #0d6b4c)` : `radial-gradient(circle at 35% 30%, #d8d0c0, #8c867c 50%, #3a3631)`,
            boxShadow: glow > 0.02 ? `0 0 ${80 * glow}px ${C.mint}` : "0 10px 30px rgba(0,0,0,.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: F.sans,
            fontWeight: 900,
            fontSize: 90,
            color: "#0b0907",
          }}
        >
          $
        </div>
      </div>
      <div style={{ position: "absolute", left: -40, right: -40, top: 300, height: 6, borderRadius: 9, background: `linear-gradient(90deg, transparent, ${C.ember}, transparent)`, boxShadow: `0 0 30px ${C.ember}` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 320, textAlign: "center", fontFamily: F.mono, fontSize: 22, color: C.ink3, letterSpacing: "0.2em" }}>SOLANA · BASE</div>
    </div>
  );
}

export function Promise({ t }: SceneProps) {
  const swap = ramp(t, 1.8, 2.1, Ease.inCubic);
  return (
    <div style={fill}>
      <Coin t={t} />
      <div style={{ position: "absolute", left: 170, top: 300, fontFamily: F.sans, fontWeight: 800, fontSize: 120, letterSpacing: "-0.045em", lineHeight: 1.02, color: C.ink, opacity: 1 - swap, transform: `translateY(${-swap * 40}px)` }}>
        <Words text="Bury your dead bag" t={t} at={0.0} stagger={0.06} style={{ justifyContent: "flex-start" }} />
        <Words text="on its own chain." t={t} at={0.5} stagger={0.06} style={{ justifyContent: "flex-start" }} color={C.ember} />
        <FadeUp t={t} at={1.0}>
          <div style={{ marginTop: 26, fontSize: 40, fontWeight: 600, letterSpacing: "-0.01em", color: C.ink3 }}>No bridge. Nothing wrapped.</div>
        </FadeUp>
      </div>
      <div style={{ position: "absolute", left: 170, top: 250, fontFamily: F.sans, fontWeight: 800, color: C.ink, opacity: ramp(t, 1.95, 2.1) }}>
        <Words text="If it ever truly comes back," t={t} at={2.0} stagger={0.05} style={{ justifyContent: "flex-start", fontSize: 84, letterSpacing: "-0.04em" }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 30, marginTop: 6 }}>
          <Pop t={t} at={2.45} from={0.4} origin="left center">
            <div style={{ fontSize: 330, fontWeight: 900, letterSpacing: "-0.06em", lineHeight: 0.95 }}>
              <Grad from={C.mintHi} to={C.mint}>{Math.round(lerp(0, 80, ramp(t, 2.45, 3.1, Ease.outExpo)))}%</Grad>
            </div>
          </Pop>
          <FadeUp t={t} at={2.75}>
            <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: "-0.035em", color: C.ink }}>back to you.</div>
          </FadeUp>
        </div>
      </div>
    </div>
  );
}

