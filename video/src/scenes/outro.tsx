import { Ease, clamp, lerp, ramp, spring } from "../kit";
import { Browser, Camera, Footage, Phone, type Shot, clipDuration } from "../media";
import { Lock, Mono, Title } from "../parts";
import { C, Chip, ECG, Embers, F, FadeUp, Grad, Pop, Slam, Words, fill } from "../ui";
import type { SceneProps } from "./types";

// ------------------------------------------------------------------ proof
export function Proof({ t }: SceneProps) {
  const ticks = Array.from({ length: 11 }, (_, i) => 1.0 + i * 0.25);
  const n = ticks.filter((x) => t >= x).length;
  const all = t >= ticks[10];
  const toLock = ramp(t, 4.1, 4.7, Ease.inOutCubic);
  const ft = clamp(t * 1.25, 0, clipDuration("verify"));
  const pulse = all ? Math.exp(-(t - ticks[10]) / 0.4) : 0;
  return (
    <div style={fill}>
      <div style={{ ...fill, opacity: 1 - toLock, transform: `translateY(${-toLock * 80}px) scale(${1 - toLock * 0.08})` }}>
        <Title t={t} text="Don't trust us. Check." sub="The judge desk re-checks every claim from public RPCs. Nothing asks our server." size={84} />
        <div style={{ position: "absolute", left: 140, top: 430 }}>
          <div style={{ fontFamily: F.sans, fontWeight: 900, fontSize: 260, letterSpacing: "-0.06em", lineHeight: 1, transform: `scale(${1 + pulse * 0.12})`, transformOrigin: "left center" }}>
            {all ? <Grad from={C.mintHi} to={C.mint}>11/11</Grad> : <span style={{ color: C.ink }}>{n}/11</span>}
          </div>
          <FadeUp t={t} at={0.8}>
            <div style={{ marginTop: 8, fontWeight: 700, fontSize: 38, color: all ? C.mintHi : C.ink2 }}>claims hold</div>
          </FadeUp>
          <FadeUp t={t} at={1.2}>
            <Mono size={22} color={C.ink3} style={{ display: "block", marginTop: 16 }}>
              /verify · npm run verify
            </Mono>
          </FadeUp>
        </div>
        <div style={{ position: "absolute", left: 760, top: 330, perspective: 1800 }}>
          <Pop t={t} at={0.25} from={0.85}>
            <div style={{ transform: `rotateY(${-8 + t * 1.5}deg)` }}>
              <Browser url="necropolis-wine.vercel.app/verify" width={1040} glow={C.mint}>
                <Camera t={t} shots={[{ t: 0, cx: 0.5, cy: 0.45, z: 1.08 }, { t: 4, cx: 0.48, cy: 0.55, z: 1.2 }]} w={1040} h={(1040 * 9) / 16}>
                  <Footage clip="verify" t={ft} />
                </Camera>
              </Browser>
            </div>
          </Pop>
        </div>
      </div>
      {toLock > 0 && (
        <div style={{ ...fill, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, opacity: toLock }}>
          <div style={{ transform: `scale(${lerp(0.6, 1, spring(t - 4.3, { stiffness: 200, damping: 14 }))})` }}>
            <Lock size={190} k={ramp(t, 4.9, 5.25, Ease.inCubic)} />
          </div>
          <div style={{ fontFamily: F.sans, fontWeight: 900, fontSize: 120, letterSpacing: "-0.05em", lineHeight: 1 }}>
            <Words text="Contract locked." t={t} at={4.6} />
          </div>
          <FadeUp t={t} at={5.3}>
            <div style={{ fontWeight: 700, fontSize: 46, color: C.ink, letterSpacing: "-0.02em", textAlign: "center" }}>
              0 access keys. Nobody can change it. <span style={{ color: C.mint }}>Not even us.</span>
            </div>
          </FadeUp>
          <FadeUp t={t} at={5.7}>
            <Mono size={22} color={C.ink3}>
              necropolis.testnet · DeleteKey BGqCS9F9…dy2asoB4Bpt6TSzmiBF9QdBkUB
            </Mono>
          </FadeUp>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ montage
type Shot1 = { clip: string; label: string; url: string; from: number; speed: number; shots: Shot[]; phone?: boolean; color: string };
const MONTAGE: Shot1[] = [
  { clip: "scan", label: "Scan any wallet.", url: "necropolis-wine.vercel.app/scan", from: 3.2, speed: 1.6, shots: [{ t: 0, cx: 0.5, cy: 0.5, z: 1.1 }, { t: 1, cx: 0.45, cy: 0.55, z: 1.3 }], color: C.ember },
  { clip: "obituary", label: "Share its obituary.", url: "necropolis-wine.vercel.app/obituary", from: 1.8, speed: 1.4, shots: [{ t: 0, cx: 0.5, cy: 0.45, z: 1.05 }, { t: 1, cx: 0.5, cy: 0.5, z: 1.25 }], color: C.magenta },
  { clip: "candle", label: "Light a candle, signed, kept on NEAR.", url: "necropolis-wine.vercel.app/grave/1", from: 2.6, speed: 2.4, shots: [{ t: 0, cx: 0.66, cy: 0.42, z: 1.25 }, { t: 1, cx: 0.7, cy: 0.42, z: 1.6 }], color: C.emberHi },
  { clip: "crypt", label: "A crypt only the holder can open.", url: "necropolis-wine.vercel.app/crypt/9", from: 3.6, speed: 3.0, shots: [{ t: 0, cx: 0.5, cy: 0.45, z: 1.15 }, { t: 1, cx: 0.48, cy: 0.4, z: 1.35 }], color: C.violet },
  { clip: "cemetery", label: "A cemetery that remembers.", url: "necropolis-wine.vercel.app/cemetery", from: 3.5, speed: 2.4, shots: [{ t: 0, cx: 0.5, cy: 0.5, z: 1.05 }, { t: 1, cx: 0.5, cy: 0.5, z: 1.2 }], color: C.sky },
  { clip: "m-grave", label: "On your phone, too.", url: "", from: 2.0, speed: 2.2, shots: [], phone: true, color: C.mint },
];

export function Montage({ t }: SceneProps) {
  const i = clamp(Math.floor(t), 0, MONTAGE.length - 1);
  return (
    <div style={fill}>
      {MONTAGE.map((s, k) => {
        const lt = t - k;
        if (lt < -0.12 || lt > 1.12) return null;
        const inK = ramp(lt, -0.12, 0.1, Ease.outCubic);
        const outK = k < MONTAGE.length - 1 ? ramp(lt, 0.9, 1.12, Ease.inCubic) : 0;
        const x = (1 - inK) * 900 - outK * 900;
        const blur = (1 - inK) * 22 + outK * 22;
        const ft = clamp(s.from + Math.max(0, lt) * s.speed, 0, clipDuration(s.clip));
        return (
          <div key={s.clip} style={{ ...fill, transform: `translateX(${x}px)`, filter: blur > 0.5 ? `blur(${blur}px)` : undefined }}>
            <div style={{ position: "absolute", left: s.phone ? 1080 : 330, top: s.phone ? 60 : 120, transform: `scale(${1 + Math.max(0, lt) * 0.04})` }}>
              {s.phone ? (
                <Phone width={430} glow={s.color}>
                  <Footage clip={s.clip} t={ft} />
                </Phone>
              ) : (
                <Browser url={s.url} width={1260} glow={s.color}>
                  <Camera t={Math.max(0, lt)} shots={s.shots} w={1260} h={(1260 * 9) / 16}>
                    <Footage clip={s.clip} t={ft} />
                  </Camera>
                </Browser>
              )}
            </div>
            <div style={{ position: "absolute", left: s.phone ? 150 : 120, bottom: s.phone ? 420 : 70, display: "flex", alignItems: "baseline", gap: 22, maxWidth: s.phone ? 840 : 1700 }}>
              <span style={{ fontFamily: F.mono, fontSize: 30, color: s.color, fontWeight: 600 }}>0{k + 1}</span>
              <span style={{ fontFamily: F.sans, fontWeight: 900, fontSize: s.phone ? 96 : 76, letterSpacing: "-0.045em", lineHeight: 1.02, color: C.ink, textShadow: "0 6px 30px rgba(0,0,0,.8)" }}>{s.label}</span>
            </div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 120, right: 120, bottom: 36, display: "flex", gap: 10 }}>
        {MONTAGE.map((s, k) => (
          <div key={s.clip} style={{ flex: 1, height: 5, borderRadius: 9, background: k < i ? `${s.color}aa` : k === i ? s.color : "#ffffff22", boxShadow: k === i ? `0 0 14px ${s.color}` : undefined }} />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ call to action
const URL = "necropolis-wine.vercel.app";

export function Cta({ t, T }: SceneProps) {
  const typed = Math.round(lerp(0, URL.length, ramp(t, 0.9, 2.0, Ease.linear)));
  const caret = Math.floor(t * 2.5) % 2 === 0;
  const a = 1 - ramp(t, 3.7, 4.05, Ease.inCubic);
  const b = ramp(t, 3.95, 4.3) * (1 - ramp(t, 7.55, 8.0, Ease.inExpo));
  const end = t - 8.0;
  const fadeOut = ramp(t, 11.4, 12.0, Ease.inQuad);
  return (
    <div style={{ ...fill, opacity: 1 - fadeOut }}>
      {a > 0 && (
        <div style={{ ...fill, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, opacity: a, transform: `translateY(${-(1 - a) * 60}px)` }}>
          <div style={{ fontFamily: F.sans, fontWeight: 900, fontSize: 150, letterSpacing: "-0.055em", lineHeight: 1 }}>
            <Words text="Try it now." t={t} at={0.0} />
          </div>
          <div style={{ fontFamily: F.sans, fontWeight: 800, fontSize: 84, letterSpacing: "-0.045em" }}>
            <Words text="No wallet needed." t={t} at={0.35} color={C.ember} />
          </div>
          <Pop t={t} at={0.75}>
            <div
              style={{
                marginTop: 36,
                padding: "26px 46px",
                borderRadius: 999,
                background: "linear-gradient(180deg, #221c18, #120f0d)",
                border: `2px solid ${C.ember}`,
                boxShadow: `0 0 60px ${C.ember}66, inset 0 1px 0 #ffffff22`,
                fontFamily: F.mono,
                fontWeight: 600,
                fontSize: 64,
                color: C.ink,
                letterSpacing: "-0.02em",
                minWidth: 1130,
                textAlign: "center",
              }}
            >
              {URL.slice(0, typed)}
              <span style={{ color: C.ember, opacity: caret ? 1 : 0 }}>▍</span>
            </div>
          </Pop>
          <FadeUp t={t} at={2.1}>
            <Mono size={28} color={C.ink2}>
              Connect → Use a throwaway wallet → bury a test bag
            </Mono>
          </FadeUp>
        </div>
      )}
      {b > 0 && (
        <div style={{ ...fill, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30, opacity: b, transform: `scale(${1 - (1 - b) * 0.08})` }}>
          <div style={{ fontFamily: F.sans, fontWeight: 900, fontSize: 118, letterSpacing: "-0.05em", lineHeight: 1 }}>
            <Words text="Built at NEAR HACKATHON" t={t} at={4.0} wordStyle={(i) => (i >= 2 ? { color: C.mint } : undefined)} />
          </div>
          <div style={{ display: "flex", gap: 18 }}>
            {[
              ["Memecoins With Mechanics", C.ember],
              ["NFTs That Do Something", C.violet],
              ["Open Innovation", C.mint],
            ].map(([n, c], i) => (
              <Pop key={n} t={t} at={4.5 + i * 0.15}>
                <Chip color={c}>{n}</Chip>
              </Pop>
            ))}
          </div>
          <FadeUp t={t} at={5.1}>
            <div style={{ display: "flex", gap: 40, alignItems: "center", marginTop: 20 }}>
              <Mono size={34} color={C.ink}>
                github.com/BoyofMars/necropolis
              </Mono>
              <Mono size={30} color={C.ink3}>
                open source · MIT
              </Mono>
            </div>
          </FadeUp>
          <FadeUp t={t} at={5.5}>
            <Mono size={30} color={C.ink2}>
              @NEARProtocol · #NEARHackathon
            </Mono>
          </FadeUp>
        </div>
      )}
      {end >= 0 && (
        <>
          <Embers T={T} count={70} burstAt={T - end} seed="end" color={C.emberHi} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 300 }}>
            <Slam text="NECROPOLIS" t={end} at={0} style={{ fontFamily: F.display, fontWeight: 700, fontSize: 200, letterSpacing: "0.08em", color: C.ink, textShadow: `0 0 60px ${C.ember}aa, 0 0 140px ${C.ember}55` }} />
            <div style={{ marginTop: 22, textAlign: "center", fontFamily: F.sans, fontWeight: 700, fontSize: 54, letterSpacing: "-0.02em", color: C.ink2 }}>
              <Words text="Bury the bag. Keep the upside." t={end} at={0.45} />
            </div>
          </div>
          <div style={{ position: "absolute", left: 0, top: 690, opacity: ramp(end, 1.6, 2.0) }}>
            <ECG T={end - 2.0} beats={[0.0, 0.8]} color={C.mint} height={220} span={2.6} headX={0.66} amp={0.9} />
          </div>
        </>
      )}
    </div>
  );
}

