import { Ease, clamp, fmt, lerp, ramp, spring } from "../kit";
import { Browser, Camera, Footage, clipDuration } from "../media";
import { Card, Check, Eyebrow, Mono, Title, Wire, short } from "../parts";
import { C, Chip, F, FadeUp, Grad, Pop, fill } from "../ui";
import { data, type SceneProps } from "./types";

const SUB = 5; // seconds per beat

function Section({ t, i, children }: { t: number; i: number; children: (lt: number) => React.ReactNode }) {
  const lt = t - i * SUB;
  if (lt < -0.3 || lt > SUB + 0.3) return null;
  const k = ramp(lt, -0.15, 0.3, Ease.outCubic);
  const o = i < 3 ? ramp(lt, SUB - 0.25, SUB + 0.1, Ease.inCubic) : 0;
  return <div style={{ ...fill, opacity: k * (1 - o), transform: `translateX(${(1 - k) * 80 - o * 80}px)` }}>{children(lt)}</div>;
}

function KeyGlyph({ crossed = false, color = C.ember }: { crossed?: boolean; color?: string }) {
  return (
    <svg width="90" height="90" viewBox="0 0 90 90">
      <circle cx="30" cy="45" r="17" fill="none" stroke={color} strokeWidth="7" />
      <path d="M47 45 H82 M70 45 V58 M80 45 V54" stroke={color} strokeWidth="7" strokeLinecap="round" />
      {crossed && <path d="M10 12 L82 80" stroke={C.danger} strokeWidth="8" strokeLinecap="round" />}
    </svg>
  );
}

/** 1 · The vault: an address on Solana that only the contract can sign for. */
function Vault({ t }: { t: number }) {
  const d = data();
  return (
    <>
      <Title t={t} text="No bridge." sub="Your bag goes to an address on its own chain that only the NEAR contract can sign for." />
      <div style={{ position: "absolute", left: 170, top: 480 }}>
        <Pop t={t} at={0.5}>
          <Card color={C.mint} style={{ width: 520 }}>
            <Eyebrow color={C.mint}>NEAR · smart contract</Eyebrow>
            <div style={{ marginTop: 10, fontFamily: F.mono, fontSize: 36, fontWeight: 600 }}>necropolis.testnet</div>
            <div style={{ marginTop: 10, fontSize: 24, color: C.ink2 }}>asks NEAR&rsquo;s MPC network to sign</div>
          </Card>
        </Pop>
      </div>
      <Wire t={t} at={1.0} x1={700} y1={570} x2={1210} y2={570} color={C.mint} curve={60} />
      <div style={{ position: "absolute", left: 830, top: 445, width: 260, textAlign: "center" }}>
        <FadeUp t={t} at={1.2}>
          <Chip color={C.mint} dot={false} style={{ fontSize: 22, padding: "8px 16px" }}>Chain Signatures</Chip>
        </FadeUp>
      </div>
      <div style={{ position: "absolute", left: 1220, top: 470 }}>
        <Pop t={t} at={1.5}>
          <Card color={C.sol} style={{ width: 560 }}>
            <Eyebrow color={C.sol}>Solana · the grave&rsquo;s vault</Eyebrow>
            <div style={{ marginTop: 10, fontFamily: F.mono, fontSize: 32, fontWeight: 600 }}>{short(d.grave.graveAddress, 8, 8)}</div>
            <div style={{ marginTop: 10, fontSize: 26, color: C.ink }}>
              {d.grave.amount} <span style={{ color: C.ember, fontWeight: 800 }}>${d.grave.symbol}</span> inside
            </div>
          </Card>
        </Pop>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 790, display: "flex", justifyContent: "center", alignItems: "center", gap: 26 }}>
        <Pop t={t} at={2.6}>
          <KeyGlyph crossed />
        </Pop>
        <FadeUp t={t} at={2.75}>
          <div style={{ fontFamily: F.sans, fontWeight: 800, fontSize: 56, letterSpacing: "-0.035em" }}>
            Nobody holds its key. <span style={{ color: C.ember }}>Not even us.</span>
          </div>
        </FadeUp>
      </div>
    </>
  );
}

/** A ring of MPC nodes, sweeping. */
function MpcRing({ t, x, y, r = 120, active = 1 }: { t: number; x: number; y: number; r?: number; active?: number }) {
  const n = 9;
  const sweep = t * 2.4;
  return (
    <div style={{ position: "absolute", left: x - r - 30, top: y - r - 30, width: (r + 30) * 2, height: (r + 30) * 2 }}>
      <div style={{ position: "absolute", inset: 30, borderRadius: 999, background: `conic-gradient(from ${sweep}rad, ${C.mint}00 0deg, ${C.mint}66 50deg, ${C.mint}00 90deg)`, opacity: active }} />
      <div style={{ position: "absolute", inset: 30, borderRadius: 999, border: `2px dashed ${C.mint}55` }} />
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const lit = 0.5 + 0.5 * Math.sin(t * 6 - i);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: r + 30 + Math.cos(a) * r - 14,
              top: r + 30 + Math.sin(a) * r - 14,
              width: 28,
              height: 28,
              borderRadius: 99,
              background: C.mint,
              opacity: 0.45 + 0.55 * lit * active,
              boxShadow: `0 0 ${10 + 20 * lit}px ${C.mint}`,
            }}
          />
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: r + 30 - 26, textAlign: "center", fontFamily: F.sans, fontWeight: 900, fontSize: 34, color: C.ink }}>
        NEAR
        <div style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 18, color: C.mint, letterSpacing: "0.2em" }}>MPC</div>
      </div>
    </div>
  );
}

/** 2 · NEAR's MPC network reads the deposit on Solana itself. */
function Verify({ t }: { t: number }) {
  const d = data();
  const ok = ramp(t, 2.6, 3.0, Ease.outCubic);
  return (
    <>
      <Title t={t} text="NEAR checks the deposit itself." sub="Its MPC network reads Solana directly. No oracle, no watcher, no trust in us." />
      <div style={{ position: "absolute", left: 150, top: 500 }}>
        <Pop t={t} at={0.45}>
          <Card color={C.sol} style={{ width: 470 }}>
            <Eyebrow color={C.sol}>Solana transaction</Eyebrow>
            <div style={{ marginTop: 10, fontFamily: F.mono, fontSize: 30, fontWeight: 600 }}>{short(d.grave.depositTx, 8, 6)}</div>
            <div style={{ marginTop: 8, fontSize: 24, color: C.ink2 }}>
              {d.grave.amount} ${d.grave.symbol} → the vault
            </div>
          </Card>
        </Pop>
      </div>
      <Wire t={t} at={0.9} x1={640} y1={590} x2={820} y2={590} color={C.sol} />
      <MpcRing t={t} x={960} y={590} r={118} active={ramp(t, 0.9, 1.4)} />
      <Wire t={t} at={1.8} x1={1100} y1={590} x2={1280} y2={590} color={C.mint} />
      <div style={{ position: "absolute", left: 1290, top: 480 }}>
        <Pop t={t} at={2.2}>
          <Card color={C.mint} style={{ width: 500 }}>
            <Eyebrow color={C.mint}>payload hash</Eyebrow>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 14 }}>
              <Mono size={30} color={C.ink}>
                {short(d.grave.proofHash, 8, 6)}
              </Mono>
              <Check size={44} k={ok} />
            </div>
            <div style={{ marginTop: 12, fontSize: 26, fontWeight: 700, color: ok > 0.5 ? C.mintHi : C.ink3 }}>{ok > 0.5 ? "matches · grave minted" : "checking…"}</div>
          </Card>
        </Pop>
      </div>
    </>
  );
}

/** 3 · NEAR MPC reads the market, so a comeback can't be faked. */
function Market({ t }: { t: number }) {
  const dur = clipDuration("market");
  const ft = clamp(t * 0.9 + 1.2, 0, dur);
  const w = 1000;
  return (
    <>
      <Title t={t} text="NEAR reads the market too." sub="Liquidity and market cap come from a real pool, read by MPC. A comeback can't be faked." size={84} />
      <div style={{ position: "absolute", left: 120, top: 390, display: "flex", flexDirection: "column", gap: 26 }}>
        {[
          ["Liquidity", 118987],
          ["Market cap", 363060],
        ].map(([label, v], i) => (
          <Pop key={label} t={t} at={0.6 + i * 0.3} origin="left center">
            <Card color={C.mint} style={{ width: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <Eyebrow>{label as string}</Eyebrow>
                <div style={{ fontFamily: F.sans, fontWeight: 900, fontSize: 72, letterSpacing: "-0.04em" }}>
                  <Grad from={C.mintHi} to={C.mint}>${fmt(lerp(0, v as number, ramp(t, 0.7 + i * 0.3, 1.9 + i * 0.3, Ease.outExpo)))}</Grad>
                </div>
              </div>
              <div style={{ fontFamily: F.mono, fontWeight: 600, fontSize: 24, color: "#04130d", background: C.mint, borderRadius: 10, padding: "6px 14px", boxShadow: `0 0 24px ${C.mint}` }}>MPC</div>
            </Card>
          </Pop>
        ))}
        <FadeUp t={t} at={1.6}>
          <Mono size={22} color={C.ink3}>
            $NGMI · a Raydium pool on Solana devnet
          </Mono>
        </FadeUp>
      </div>
      <div style={{ position: "absolute", left: 800, top: 400, perspective: 1800 }}>
        <Pop t={t} at={0.3} from={0.85}>
          <div style={{ transform: `rotateY(${-10 + t * 1.6}deg)` }}>
            <Browser url="necropolis-wine.vercel.app/grave/3" width={w} glow={C.mint}>
              <Camera t={t} shots={[{ t: 0, cx: 0.6, cy: 0.5, z: 1.05 }, { t: 4.5, cx: 0.66, cy: 0.55, z: 1.25 }]} w={w} h={(w * 9) / 16}>
                <Footage clip="market" t={ft} />
              </Camera>
            </Browser>
          </div>
        </Pop>
      </div>
    </>
  );
}

function WalletCard({ t, at, label, sub, color, x, y }: { t: number; at: number; label: string; sub: string; color: string; x: number; y: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y }}>
      <Pop t={t} at={at}>
        <Card color={color} style={{ width: 430, display: "flex", alignItems: "center", gap: 20 }}>
          <KeyGlyph color={color} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 34 }}>{label}</div>
            <Mono size={20} color={C.ink3}>
              {sub}
            </Mono>
          </div>
        </Card>
      </Pop>
    </div>
  );
}

/** 4 · Your Solana or EVM key is already a NEAR account. */
function NoWallet({ t }: { t: number }) {
  const s = spring(t - 1.6, { stiffness: 140, damping: 14 });
  return (
    <>
      <Title t={t} text="No NEAR wallet needed." sub="Your Solana or EVM key already is a NEAR account. The contract checks your signature on-chain." />
      <WalletCard t={t} at={0.4} label="Solana key" sub="Phantom · Solflare" color={C.sol} x={160} y={470} />
      <WalletCard t={t} at={0.6} label="EVM key" sub="MetaMask · any wallet" color={C.base} x={160} y={680} />
      <Wire t={t} at={1.0} x1={600} y1={560} x2={1120} y2={650} color={C.sol} curve={-40} />
      <Wire t={t} at={1.15} x1={600} y1={770} x2={1120} y2={680} color={C.base} curve={40} />
      <div style={{ position: "absolute", left: 1130, top: 520, transform: `scale(${lerp(0.6, 1, s)})`, opacity: clamp(s * 2), transformOrigin: "left center" }}>
        <Card color={C.mint} style={{ width: 640 }}>
          <Eyebrow color={C.mint}>a NEAR account, already</Eyebrow>
          <div style={{ marginTop: 10, fontFamily: F.mono, fontSize: 28 }}>{short(data().grave.owner, 10, 8)}</div>
          <div style={{ marginTop: 4, fontFamily: F.mono, fontSize: 22, color: C.ink3 }}>grave Nº {data().grave.id}&rsquo;s owner · from a Solana key</div>
          <div style={{ marginTop: 8, fontFamily: F.mono, fontSize: 28 }}>0x… <span style={{ fontSize: 22, color: C.ink3 }}>an EVM address is one too (NEP-518)</span></div>
          <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
            <Chip color={C.mint} dot={false} style={{ fontSize: 20, padding: "6px 14px" }}>ed25519_verify</Chip>
            <Chip color={C.mint} dot={false} style={{ fontSize: 20, padding: "6px 14px" }}>ecrecover</Chip>
          </div>
        </Card>
      </div>
      <div style={{ position: "absolute", left: 1130, top: 870 }}>
        <FadeUp t={t} at={2.6}>
          <Mono size={22} color={C.ink3}>
            Already on NEAR? HOT, Intear, MyNearWallet work too.
          </Mono>
        </FadeUp>
      </div>
    </>
  );
}

export function Near({ t }: SceneProps) {
  const intro = ramp(t, -0.3, 0.2);
  return (
    <div style={{ ...fill, opacity: clamp(intro + 0.001) }}>
      <div style={{ position: "absolute", right: 120, top: 70 }}>
        <FadeUp t={t} at={0.1}>
          <Chip color={C.mint}>Why NEAR</Chip>
        </FadeUp>
      </div>
      <Section t={t} i={0}>{(lt) => <Vault t={lt} />}</Section>
      <Section t={t} i={1}>{(lt) => <Verify t={lt} />}</Section>
      <Section t={t} i={2}>{(lt) => <Market t={lt} />}</Section>
      <Section t={t} i={3}>{(lt) => <NoWallet t={lt} />}</Section>
    </div>
  );
}
