import { Ease, clamp, lerp, ramp, spring } from "../kit";
import { Browser, Camera, Footage, type Seg, mark, remap } from "../media";
import { Card, Wire } from "../parts";
import { C, Chip, Embers, F, Pop, fill } from "../ui";
import { data, type SceneProps } from "./types";

const CLIP = "bury";
const BW = 1400; // browser width
const BH = (BW * 9) / 16;

function segments(): Seg[] {
  const m = (n: string) => mark(CLIP, n);
  const sign = m("sign");
  const done = m("done");
  return [
    { a: m("connect") - 0.3, b: m("claim") + 1.8, d: 4.5 },
    { a: m("bags") - 0.2, b: m("prepare") + 0.5, d: 3.5 },
    { a: m("review") + 0.1, b: sign + 0.5, d: 5.5 },
    { a: sign + 0.5, b: done, d: 4.5 },
    { a: done, b: m("visit") + 0.2, d: 2.0 },
    { a: m("gravepage") + 0.3, b: m("account") + 1.4, d: 2.0 },
  ];
}

const pad = (n: number) => String(n).padStart(6, "0");

export function Bury({ t }: SceneProps) {
  const d = data();
  const segs = segments();
  const starts = segs.reduce<number[]>((a, s) => [...a, a[a.length - 1] + s.d], [0]);
  const seg = Math.max(0, starts.findIndex((s, i) => t >= s && t < (starts[i + 1] ?? Infinity)));
  const clipT = remap(clamp(t, 0, starts[starts.length - 1] - 0.001), segs);
  const sign = mark(CLIP, "sign");
  const steps: [string, string][] = [
    ["01", "No wallet? One click."],
    ["02", "Pick a dead bag."],
    ["03", "Read the deal. Sign once."],
    ["04", "NEAR MPC checks the deposit on Solana."],
    ["05", `Grave Nº ${pad(d.grave.id)} minted.`],
    ["06", "An NFT with its own NEAR account."],
  ];

  // Camera: one shot per segment, easing between them.
  const shots = [
    { t: 0, cx: 0.5, cy: 0.5, z: 1 },
    { t: 1.0, cx: 0.48, cy: 0.42, z: 1.3 }, // the throwaway-wallet card
    { t: 2.4, cx: 0.48, cy: 0.42, z: 1.3 },
    { t: 3.1, cx: 0.6, cy: 0.45, z: 1.2 }, // "Claim test bags"
    { t: starts[1] - 0.2, cx: 0.6, cy: 0.45, z: 1.2 },
    { t: starts[1] + 0.3, cx: 0.35, cy: 0.66, z: 1.3 }, // the bag list
    { t: starts[2] - 0.2, cx: 0.35, cy: 0.62, z: 1.3 },
    { t: starts[2] + 0.3, cx: 0.36, cy: 0.5, z: 1.18 }, // the deal
    { t: starts[3] - 0.5, cx: 0.36, cy: 0.56, z: 1.25 },
    { t: starts[3] + 0.4, cx: 0.35, cy: 0.38, z: 1.45 }, // interment steps
    { t: starts[4] - 0.15, cx: 0.35, cy: 0.38, z: 1.45 },
    { t: starts[4] + 0.3, cx: 0.35, cy: 0.37, z: 1.62 }, // Here lies Nº …
    { t: starts[5] - 0.1, cx: 0.35, cy: 0.4, z: 1.5 },
    { t: starts[5] + 0.3, cx: 0.5, cy: 0.45, z: 1.05 }, // the grave page
    { t: starts[6], cx: 0.68, cy: 0.38, z: 1.38 }, // its account
  ];

  const enter = spring(t, { stiffness: 120, damping: 16 });
  const minted = t - starts[4];
  // A quick punch-in at every jump in the footage hides the cut.
  const bump = starts.slice(1, 6).reduce((acc, s) => acc + Math.max(0, 1 - Math.abs(t - s) / 0.12) * 0.035, 0);
  const cutFlash = starts.slice(1, 6).reduce((acc, s) => Math.max(acc, Math.max(0, 1 - Math.abs(t - s) / 0.08)), 0);
  const glow = minted >= 0 ? Math.exp(-minted / 0.6) : 0;
  const glowColor = glow > 0.05 ? C.mint : C.ember;

  return (
    <div style={fill}>
      {minted >= 0 && minted < 3 && <Embers T={minted + 100} count={60} burstAt={100} seed="mint" color={C.mint} />}
      {/* Step headline */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 36, height: 110, overflow: "hidden" }}>
        {steps.map(([n, text], i) => {
          const k = ramp(t, starts[i] - 0.05, starts[i] + 0.4, Ease.outQuint);
          const o = i < steps.length - 1 ? ramp(t, starts[i + 1] - 0.18, starts[i + 1] + 0.12, Ease.inCubic) : 0;
          if (k <= 0 || o >= 1) return null;
          return (
            <div key={n} style={{ position: "absolute", left: 0, right: 0, top: 0, display: "flex", justifyContent: "center", alignItems: "baseline", gap: 26, transform: `translateY(${(1 - k) * 110 - o * 110}px)`, opacity: k * (1 - o) }}>
              <span style={{ fontFamily: F.mono, fontSize: 34, color: i === 4 ? C.mint : C.ember, fontWeight: 600 }}>{n}</span>
              <span style={{ fontFamily: F.sans, fontWeight: 800, fontSize: 70, letterSpacing: "-0.04em", color: i === 4 ? C.mintHi : C.ink }}>{text}</span>
            </div>
          );
        })}
      </div>

      {/* The real app */}
      <div
        style={{
          position: "absolute",
          left: (1920 - BW) / 2,
          top: 200,
          perspective: 2200,
          transform: `translateY(${(1 - enter) * 420}px) scale(${lerp(0.86, 1, enter) + bump})`,
          opacity: clamp(t / 0.15),
        }}
      >
        <div style={{ transform: `rotateX(${(1 - enter) * 18 + Math.sin(t * 0.6) * 1.2}deg) rotateY(${Math.sin(t * 0.45) * 2}deg)` }}>
          <Browser
            url={seg >= 5 ? `necropolis-wine.vercel.app/grave/${d.grave.id}` : "necropolis-wine.vercel.app/bury"}
            width={BW}
            glow={glowColor}
            style={{ boxShadow: `0 60px 140px rgba(0,0,0,.65), 0 0 0 1.5px rgba(255,255,255,.09), 0 0 ${120 + glow * 200}px ${glowColor}${glow > 0.05 ? "88" : "30"}` }}
          >
            <Camera t={t} shots={shots} w={BW} h={BH}>
              <Footage clip={CLIP} t={clipT} />
            </Camera>
            {cutFlash > 0 && <div style={{ ...fill, background: "#fff", opacity: cutFlash * 0.35 }} />}
          </Browser>
        </div>
      </div>

      {/* 01: no wallet needed */}
      {seg === 0 && (
        <div style={{ position: "absolute", right: 120, bottom: 70 }}>
          <Pop t={t} at={1.3} out={starts[1] - 0.35}>
            <Chip color={C.mint}>No extension · no SOL · testnet</Chip>
          </Pop>
        </div>
      )}

      {/* 04: verification, fast-forwarded, with the real elapsed time */}
      {seg === 3 && (
        <>
          <div style={{ position: "absolute", right: 110, bottom: 60 }}>
            <Pop t={t} at={starts[3] + 0.2}>
              <Card color={C.mint} style={{ padding: "18px 26px", display: "flex", alignItems: "center", gap: 22 }}>
                <div style={{ fontFamily: F.mono, fontSize: 20, color: C.ink3, letterSpacing: "0.15em" }}>SINCE SIGNING</div>
                <div style={{ fontFamily: F.sans, fontWeight: 900, fontSize: 64, color: C.mintHi, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{Math.max(0, clipT - sign).toFixed(1)} s</div>
                <div style={{ fontFamily: F.mono, fontSize: 22, color: C.ember, border: `1.5px solid ${C.ember}`, borderRadius: 8, padding: "2px 10px" }}>▶▶ ×{Math.round((segs[3].b - segs[3].a) / segs[3].d)}</div>
              </Card>
            </Pop>
          </div>
          <div style={{ position: "absolute", left: 110, bottom: 60, width: 760, height: 150 }}>
            <Pop t={t} at={starts[3] + 0.35} origin="left center">
              <Card color={C.violet} style={{ position: "relative", width: 760, height: 150, padding: 0 }}>
                {(
                  [
                    ["Solana devnet", "deposit", C.sol, 130],
                    ["NEAR MPC", "reads it", C.mint, 380],
                    ["necropolis.testnet", "mints", C.ember, 630],
                  ] as const
                ).map(([name, verb, col, x]) => (
                  <div key={name} style={{ position: "absolute", left: x - 120, top: 30, width: 240, textAlign: "center" }}>
                    <div style={{ width: 22, height: 22, borderRadius: 99, margin: "0 auto 12px", background: col, boxShadow: `0 0 24px ${col}` }} />
                    <div style={{ fontFamily: F.sans, fontWeight: 800, fontSize: 25, color: C.ink }}>{name}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 18, color: C.ink3 }}>{verb}</div>
                  </div>
                ))}
                <Wire t={t} at={starts[3] + 0.5} x1={155} y1={41} x2={355} y2={41} color={C.sol} pulses={2} width={4} />
                <Wire t={t} at={starts[3] + 0.9} x1={405} y1={41} x2={605} y2={41} color={C.mint} pulses={2} width={4} />
              </Card>
            </Pop>
          </div>
        </>
      )}

      {/* 06: what the grave holds */}
      {seg === 5 && (
        <div style={{ position: "absolute", right: 120, bottom: 64, display: "flex", gap: 18 }}>
          <Pop t={t} at={starts[5] + 0.45}>
            <Chip color={C.mint}>0 access keys</Chip>
          </Pop>
          <Pop t={t} at={starts[5] + 0.65}>
            <Chip color={C.ember}>{d.grave.bones.toFixed(2)} $BONES inside</Chip>
          </Pop>
        </div>
      )}
      {minted >= 0 && minted < 1 && <div style={{ ...fill, background: `radial-gradient(circle at 50% 55%, ${C.mint}55, transparent 60%)`, opacity: glow }} />}
    </div>
  );
}
