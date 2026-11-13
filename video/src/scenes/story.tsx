import { Ease, clamp, fmt, lerp, ramp, spring } from "../kit";
import { Browser, Camera, Footage, clipDuration } from "../media";
import { Card, Check, Cross, Eyebrow, Lock, Mono, Stamp, Title, Wire } from "../parts";
import { C, Chip, Embers, F, FadeUp, Grad, Pop, Words, fill } from "../ui";
import { data, type SceneProps } from "./types";

// ------------------------------------------------------------------ the rising
const RITE: [string, string][] = [
  ["Liquidity", "≥ $50k"],
  ["Volume", "≥ $25k a day"],
  ["Traders", "≥ 100 a day"],
  ["Market cap", "≥ 5× burial"],
  ["Wash trading", "≤ 30% flagged"],
];

export function Rise({ t, T }: SceneProps) {
  const risen = t - 4.0;
  const pre = 1 - ramp(t, 3.65, 4.0, Ease.inCubic);
  return (
    <div style={fill}>
      {pre > 0 && (
        <div style={{ ...fill, opacity: pre, transform: `scale(${lerp(0.9, 1, pre)})` }}>
          <Title t={t} text="When a coin really comes back…" sub="The contract judges it, on terms frozen the day it was buried." />
          <div style={{ position: "absolute", left: 160, top: 400, width: 980 }}>
            <Card color={C.ember} style={{ padding: "18px 34px" }}>
              {RITE.map(([k, v], i) => {
                const on = ramp(t, 0.5 + i * 0.5, 0.85 + i * 0.5, Ease.outCubic);
                return (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 24, padding: "14px 0", borderBottom: i < 4 ? "1px solid #2c2621" : undefined }}>
                    <div style={{ width: 230, fontWeight: 800, fontSize: 34 }}>{k}</div>
                    <Mono size={26} color={C.ink3} style={{ width: 250 }}>
                      {v}
                    </Mono>
                    <div style={{ flex: 1, height: 14, borderRadius: 9, background: "#2a2420", overflow: "hidden" }}>
                      <div style={{ width: `${on * 100}%`, height: "100%", background: `linear-gradient(90deg, ${C.ember}, ${C.mint})`, boxShadow: `0 0 18px ${C.mint}` }} />
                    </div>
                    <Check size={42} k={on} />
                  </div>
                );
              })}
            </Card>
          </div>
          <div style={{ position: "absolute", left: 1270, top: 420, width: 460, height: 460 }}>
            <svg width="460" height="460" viewBox="0 0 460 460">
              <circle cx="230" cy="230" r="190" fill="none" stroke="#2a2420" strokeWidth="26" />
              <circle
                cx="230"
                cy="230"
                r="190"
                fill="none"
                stroke={C.mint}
                strokeWidth="26"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 190}
                strokeDashoffset={2 * Math.PI * 190 * (1 - ramp(t, 0.4, 3.6, Ease.inOutQuad))}
                transform="rotate(-90 230 230)"
                style={{ filter: `drop-shadow(0 0 16px ${C.mint})` }}
              />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontFamily: F.sans, fontWeight: 900, fontSize: 130, letterSpacing: "-0.05em", lineHeight: 1 }}>{Math.min(14, Math.floor(ramp(t, 0.4, 3.6, Ease.inOutQuad) * 14 + 0.0001))}</div>
              <div style={{ fontWeight: 700, fontSize: 32, color: C.ink2 }}>days in a row</div>
              <Mono size={20} color={C.ink3} style={{ marginTop: 6 }}>
                6 minutes on testnet
              </Mono>
            </div>
          </div>
        </div>
      )}
      {risen >= 0 && (
        <>
          <Embers T={T} count={80} burstAt={T - risen} seed="risen" color={C.mintHi} />
          <div style={{ ...fill, background: `radial-gradient(circle at 50% 42%, ${C.mint}${Math.round(clamp(0.45 * Math.exp(-risen / 0.9)) * 255).toString(16).padStart(2, "0")}, transparent 60%)` }} />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: lerp(250, 110, ramp(risen, 1.0, 1.5, Ease.inOutCubic)),
              textAlign: "center",
              fontFamily: F.display,
              fontStyle: "italic",
              fontWeight: 700,
              fontSize: lerp(360, 200, ramp(risen, 1.0, 1.5, Ease.inOutCubic)),
              lineHeight: 1,
              transform: `scale(${lerp(1.5, 1, spring(risen, { stiffness: 300, damping: 16 }))})`,
              opacity: clamp(risen / 0.06),
              color: C.mintHi,
              textShadow: `0 0 60px ${C.mint}, 0 0 140px ${C.mint}88`,
            }}
          >
            Risen.
          </div>
          <div style={{ position: "absolute", left: 210, right: 210, top: 470 }}>
            <FadeUp t={risen} at={1.25}>
              <div style={{ textAlign: "center", fontWeight: 700, fontSize: 40, color: C.ink, fontFamily: F.sans, letterSpacing: "-0.02em" }}>The contract builds the payout. NEAR MPC signs it from the grave&rsquo;s vault.</div>
            </FadeUp>
            <div style={{ marginTop: 60, display: "flex", height: 120, borderRadius: 24, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
              <div style={{ width: `${80 * ramp(risen, 1.5, 2.3, Ease.outExpo)}%`, background: `linear-gradient(90deg, ${C.emberDeep}, ${C.ember})`, display: "flex", alignItems: "center", paddingLeft: 36, fontFamily: F.sans, fontWeight: 900, fontSize: 64, color: "#1a0e02", overflow: "hidden", whiteSpace: "nowrap" }}>
                80% back to the owner
              </div>
              <div style={{ width: `${20 * ramp(risen, 1.8, 2.6, Ease.outExpo)}%`, background: `linear-gradient(90deg, ${C.mint}, ${C.mintHi})`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.sans, fontWeight: 900, fontSize: 52, color: "#03140d", overflow: "hidden", whiteSpace: "nowrap" }}>
                20%
              </div>
            </div>
            <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", fontFamily: F.sans, fontWeight: 700, fontSize: 32 }}>
              <FadeUp t={risen} at={2.3}>
                <span style={{ color: C.emberHi }}>
                  Live: 7,280,000 $FUMBLE back to its owner
                </span>
              </FadeUp>
              <FadeUp t={risen} at={2.6}>
                <span style={{ color: C.mintHi }}>→ the ossuary, for $BONES holders</span>
              </FadeUp>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ $BONES
function Coin({ t, size = 360 }: { t: number; size?: number }) {
  const spin = Math.cos(t * 0.8);
  return (
    <div style={{ width: size, height: size, transform: `scaleX(${0.4 + 0.6 * Math.abs(spin)})` }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          background: spin > 0 ? `radial-gradient(circle at 32% 28%, ${C.emberHi}, ${C.ember} 45%, ${C.emberDeep} 80%)` : `radial-gradient(circle at 32% 28%, #ffe2ae, #d8902a 50%, #8a5208)`,
          boxShadow: `0 0 120px ${C.ember}88, inset 0 0 0 14px #ffffff22, inset 0 -18px 40px #00000044`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: F.sans,
          fontWeight: 900,
          fontSize: size * 0.2,
          color: "#2a1602",
          letterSpacing: "-0.04em",
        }}
      >
        $BONES
      </div>
    </div>
  );
}

const BONE_STEPS = [
  { at: 0.3, title: "Bury → mint", line: "+96.56 $BONES into g9.necropolis.testnet", color: C.mint, sign: "+" },
  { at: 2.2, title: "Rise → burn", line: "−110.33 $BONES burned when $LAZARUS rose", color: C.danger, sign: "−" },
  { at: 4.1, title: "Every rising pays holders", line: "56.56 : 40 → +843,479 and +596,520 $LAZARUS", color: C.ember, sign: "%" },
];

export function Bones({ t }: SceneProps) {
  const toFootage = ramp(t, 5.8, 6.4, Ease.inOutCubic);
  const ft = clamp((t - 5.8) * 1.4 + 0.8, 0, clipDuration("bones"));
  return (
    <div style={fill}>
      <Title t={t} text="$BONES: a token whose supply follows the dead." size={76} out={5.7} />
      <div style={{ position: "absolute", left: 230, top: 380, transform: `translateX(${-toFootage * 700}px)`, opacity: 1 - toFootage }}>
        <Pop t={t} at={0.1} from={0.3}>
          <Coin t={t} />
        </Pop>
      </div>
      <div style={{ position: "absolute", left: 760, top: 340, display: "flex", flexDirection: "column", gap: 26, transform: `translateX(${-toFootage * 700}px)`, opacity: 1 - toFootage }}>
        {BONE_STEPS.map((s, i) => {
          const dim = i < 2 ? 1 - 0.55 * ramp(t, BONE_STEPS[i + 1].at, BONE_STEPS[i + 1].at + 0.3) : 1;
          return (
            <div key={s.title} style={{ opacity: dim }}>
              <Pop t={t} at={s.at} origin="left center">
                <Card color={s.color} style={{ width: 960, display: "flex", alignItems: "center", gap: 28 }}>
                  <div style={{ width: 84, height: 84, borderRadius: 22, background: `${s.color}22`, border: `2px solid ${s.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 52, color: s.color }}>{s.sign}</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 48, letterSpacing: "-0.03em" }}>{s.title}</div>
                    <Mono size={25} color={C.ink2}>
                      {s.line}
                    </Mono>
                  </div>
                </Card>
              </Pop>
            </div>
          );
        })}
      </div>
      {toFootage > 0 && (
        <>
          <div style={{ position: "absolute", left: 120, top: 100, opacity: toFootage }}>
            <div style={{ fontFamily: F.sans, fontWeight: 800, fontSize: 80, letterSpacing: "-0.045em", lineHeight: 1.05 }}>
              <Words text="No admin key." t={t} at={6.0} style={{ justifyContent: "flex-start" }} />
              <Words text="Every mint and burn, public." t={t} at={6.25} style={{ justifyContent: "flex-start" }} color={C.ember} />
            </div>
            <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
              <Pop t={t} at={6.6} origin="left center">
                <Chip color={C.mint}>get_bones_rules → setters: [ ]</Chip>
              </Pop>
              <Pop t={t} at={6.8} origin="left center">
                <Chip color={C.ember}>{fmt(data().stats.bonesSupply, 2)} $BONES in supply</Chip>
              </Pop>
            </div>
          </div>
          <div style={{ position: "absolute", left: 900, top: 290, transform: `translateX(${(1 - toFootage) * 500}px)`, opacity: toFootage }}>
            <Browser url="necropolis-wine.vercel.app/bones" width={900} glow={C.ember}>
              <Camera t={t} shots={[{ t: 6, cx: 0.5, cy: 0.5, z: 1.05 }, { t: 8, cx: 0.5, cy: 0.55, z: 1.2 }]} w={900} h={(900 * 9) / 16}>
                <Footage clip="bones" t={ft} />
              </Camera>
            </Browser>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ graves are accounts
const ATTACKS = ["Exhume the BONES", "Point the payout at itself", "Claim the share", "Sell the grave again"];

export function Accounts({ t }: SceneProps) {
  const d = data();
  const sold = ramp(t, 2.1, 2.9, Ease.inOutCubic);
  const attacks = ramp(t, 3.6, 3.9, Ease.outCubic);
  const paid = t - 6.0;
  return (
    <div style={fill}>
      <Title t={t} text="Every grave is its own account." out={1.95} />
      <div style={{ position: "absolute", left: 120, top: 90, opacity: ramp(t, 2.05, 2.3) * (1 - ramp(t, 5.85, 6.1)) }}>
        <div style={{ fontFamily: F.sans, fontWeight: 800, fontSize: 92, letterSpacing: "-0.045em" }}>
          <Words text="Sold in the middle of a payout?" t={t} at={2.1} style={{ justifyContent: "flex-start" }} />
        </div>
      </div>

      {/* The NFT */}
      <div style={{ position: "absolute", left: lerp(170, 120, sold), top: lerp(290, 330, sold), transform: `scale(${lerp(1, 0.78, sold)})`, transformOrigin: "top left", opacity: 1 - ramp(t, 5.9, 6.2) }}>
        <Pop t={t} at={0.2} from={0.6}>
          <div style={{ width: 420, borderRadius: 28, overflow: "hidden", boxShadow: `0 40px 100px rgba(0,0,0,.6), 0 0 80px ${C.ember}44`, border: `2px solid ${C.ember}66`, transform: `rotate(${lerp(-3, 2, sold)}deg)` }}>
            <img src="/public/art/grave-9.svg" style={{ width: 420, height: 504, display: "block" }} />
          </div>
        </Pop>
      </div>

      {/* Its account */}
      <div style={{ position: "absolute", left: 980, top: 300, opacity: 1 - ramp(t, 2.0, 2.4) }}>
        <Pop t={t} at={0.7} origin="left center">
          <Card color={C.mint} style={{ width: 760 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Mono size={32} color={C.ink}>
                {d.grave.account}
              </Mono>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Lock size={40} k={ramp(t, 1.1, 1.4)} />
                <Mono size={20} color={C.mint}>
                  0 KEYS
                </Mono>
              </div>
            </div>
            {[`${d.grave.bones.toFixed(2)} $BONES`, "its share of every rising", `the vault on Solana · ${d.grave.amount} $${d.grave.symbol}`].map((row, i) => (
              <FadeUp key={row} t={t} at={1.0 + i * 0.18}>
                <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 700 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 99, background: C.mint, boxShadow: `0 0 12px ${C.mint}` }} />
                  {row}
                </div>
              </FadeUp>
            ))}
          </Card>
        </Pop>
      </div>
      {t < 2.2 && <Wire t={t} at={0.9} x1={620} y1={540} x2={970} y2={480} color={C.mint} curve={40} />}

      {/* Seller → buyer */}
      {sold > 0 && (
        <div style={{ position: "absolute", left: 140, top: 760, display: "flex", alignItems: "center", gap: 20, opacity: sold * (1 - ramp(t, 5.9, 6.2)) }}>
          <Chip color={C.danger}>seller</Chip>
          <Mono size={40} color={C.ink3}>
            →
          </Mono>
          <Chip color={C.mint}>buyer</Chip>
        </div>
      )}

      {/* The seller fights back */}
      {attacks > 0 && paid < 0.3 && (
        <div style={{ position: "absolute", left: 640, top: 300, display: "flex", flexDirection: "column", gap: 22, opacity: attacks * (1 - ramp(t, 5.9, 6.2)) }}>
          <Eyebrow color={C.danger}>the seller tries to keep the money</Eyebrow>
          {ATTACKS.map((a, i) => (
            <div key={a} style={{ display: "flex", alignItems: "center", gap: 26, height: 96 }}>
              <Card color={C.danger} style={{ width: 720, padding: "18px 26px", display: "flex", alignItems: "center", gap: 18 }}>
                <Cross size={42} />
                <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em" }}>{a}</span>
              </Card>
              <Stamp t={t} at={4.0 + i * 0.5} rotate={-7 + i * 3} />
            </div>
          ))}
        </div>
      )}

      {/* The buyer is paid */}
      {paid >= 0 && (
        <div style={{ ...fill, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <Pop t={paid} at={0} from={0.5}>
            <Check size={140} k={ramp(paid, 0.05, 0.4)} />
          </Pop>
          <FadeUp t={paid} at={0.15}>
            <div style={{ fontFamily: F.sans, fontWeight: 800, fontSize: 84, letterSpacing: "-0.045em" }}>The buyer got paid.</div>
          </FadeUp>
          <Pop t={paid} at={0.35}>
            <div style={{ fontFamily: F.sans, fontWeight: 900, fontSize: 150, letterSpacing: "-0.05em", lineHeight: 1 }}>
              <Grad from={C.mintHi} to={C.mint}>+{fmt(lerp(0, 540000, ramp(paid, 0.35, 1.3, Ease.outExpo)))}</Grad>
              <span style={{ fontSize: 70, color: C.ink2 }}> $PHOENIX</span>
            </div>
          </Pop>
          <FadeUp t={paid} at={0.8}>
            <Mono size={26} color={C.ink3}>
              live on testnet · every seller attempt is a failed transaction you can look up
            </Mono>
          </FadeUp>
        </div>
      )}
    </div>
  );
}
