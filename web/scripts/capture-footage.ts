/**
 * Footage for the demo video (../video): the live app, real chain state, and
 * a real burial made with a throwaway wallet. Nothing is mocked.
 *
 * Frames come from Chrome's screencast at 2x (2560×1440, 1280×720 CSS), so the
 * video can zoom into a detail and stay sharp. A drawn cursor shows the clicks.
 * Each clip is kept as JPEG frames plus their real timings
 * (<VIDEO_DIR>/footage-raw/<clip>/frames.json); the video's renderer picks the
 * frame for each moment itself.
 *
 *   VIDEO_DIR=<video project> npx tsx scripts/capture-footage.ts            # every clip
 *   VIDEO_DIR=<video project> npx tsx scripts/capture-footage.ts verify bones
 *
 * The burial clip spends testnet funds from the relayer (a few thousandths of
 * devnet SOL and NEAR gas) and mints a real grave.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type CDPSession, type Locator, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "https://necropolis-wine.vercel.app";
const VIDEO = process.env.VIDEO_DIR ?? resolve(process.cwd(), "..", "video");
const RAW = join(VIDEO, "footage-raw");
const WALLET = "9wZiympr3GJQrqHyHW7TPEpFApVx7S4ZAHwbfhzxqibN"; // devnet test wallet from the E2E runs

const only = process.argv.slice(2);
const want = (clip: string) => only.length === 0 || only.includes(clip);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A visible cursor that follows the real mouse events, with a ripple on click. Survives navigation. */
const CURSOR = `(() => {
  const KEY = "demo:cursor";
  let el, ring;
  const ensure = () => {
    if (el || !document.documentElement) return;
    el = document.createElement("div");
    el.innerHTML = '<svg width="30" height="30" viewBox="0 0 30 30"><path d="M5 3 L5 24 L10.6 18.6 L14.6 27.2 L18.4 25.6 L14.4 17.2 L22 17.2 Z" fill="#fff" stroke="#14110d" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    el.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 3px 6px rgba(0,0,0,.55));will-change:transform";
    ring = document.createElement("div");
    ring.style.cssText = "position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #f0a63c;z-index:2147483646;pointer-events:none;opacity:0;transform:scale(.2)";
    document.documentElement.appendChild(ring);
    document.documentElement.appendChild(el);
    const p = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (p) place(p.x, p.y);
    else el.style.transform = "translate(-100px,-100px)";
  };
  const place = (x, y) => { el.style.transform = "translate(" + (x - 5) + "px," + (y - 3) + "px)"; };
  addEventListener("mousemove", (e) => { ensure(); place(e.clientX, e.clientY); sessionStorage.setItem(KEY, JSON.stringify({ x: e.clientX, y: e.clientY })); }, true);
  addEventListener("mousedown", (e) => {
    ensure();
    ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px";
    ring.animate([{ opacity: .95, transform: "scale(.2)" }, { opacity: 0, transform: "scale(1.5)" }], { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" });
  }, true);
  document.addEventListener("DOMContentLoaded", ensure);
})();`;

/** Records a page through Chrome's screencast; frames keep their real timing. */
class Recorder {
  private frames: { file: string; t: number }[] = [];
  private marks: { name: string; t: number }[] = [];
  private dir = "";
  private clip = "";
  constructor(private cdp: CDPSession) {
    cdp.on("Page.screencastFrame", (f) => {
      if (!this.dir) return;
      const file = `f${String(this.frames.length).padStart(5, "0")}.jpg`;
      writeFileSync(join(this.dir, file), Buffer.from(f.data, "base64"));
      this.frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
      this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
  }
  async start(clip: string, width = 2560, height = 1440) {
    this.clip = clip;
    this.dir = join(RAW, clip);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.marks = [];
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    console.log(`● ${clip}`);
  }
  /** A named moment in the clip (seconds from its first frame), for cutting the video to the action. */
  mark(name: string) {
    this.marks.push({ name, t: Date.now() / 1000 });
  }
  async stop() {
    const end = Date.now() / 1000;
    await this.cdp.send("Page.stopScreencast");
    const dir = this.dir;
    this.dir = "";
    const f = this.frames;
    if (f.length === 0) throw new Error(`${this.clip}: no frames`);
    const t0 = f[0].t;
    const marks = this.marks.map((m) => ({ ...m, t: +(m.t - t0).toFixed(3) }));
    writeFileSync(
      join(dir, "frames.json"),
      JSON.stringify({ clip: this.clip, duration: +(end - t0).toFixed(3), frames: f.map((x) => [x.file, +(x.t - t0).toFixed(4)]), marks }),
    );
    console.log(`  ${f.length} frames, ${(end - t0).toFixed(1)} s${marks.length ? `, marks: ${marks.map((m) => `${m.name}@${m.t}`).join(" ")}` : ""}`);
  }
}

class Driver {
  private x = 640;
  private y = 420;
  constructor(public page: Page) {}

  async moveTo(x: number, y: number, ms = 650) {
    const steps = Math.max(10, Math.round(ms / 16));
    const fx = this.x, fy = this.y;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      await this.page.mouse.move(fx + (x - fx) * e, fy + (y - fy) * e);
      await sleep(ms / steps);
    }
    this.x = x;
    this.y = y;
  }

  /** Glide the element into view if needed, move the cursor onto it, click. */
  async click(target: Locator, opts: { ms?: number; settle?: number } = {}) {
    await target.waitFor({ state: "visible", timeout: 90_000 });
    await this.reveal(target);
    const b = await target.boundingBox();
    if (!b) throw new Error("no box");
    await this.moveTo(b.x + b.width / 2, b.y + b.height / 2, opts.ms ?? 700);
    await sleep(160);
    await this.page.mouse.down();
    await sleep(90);
    await this.page.mouse.up();
    await sleep(opts.settle ?? 400);
  }

  async reveal(target: Locator) {
    const b = await target.boundingBox();
    const vh = this.page.viewportSize()!.height;
    if (b && (b.y < 70 || b.y + b.height > vh - 40)) await this.glideBy(b.y - vh * 0.45, 900);
  }

  /** Smooth scroll by pixels, eased. Passed as a string so tsx doesn't inject helpers into the page. */
  async glideBy(px: number, ms = 1600) {
    await this.page.evaluate(`new Promise((done) => {
      const from = window.scrollY, to = Math.max(0, from + ${px}), ms = ${ms}, t0 = performance.now();
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        window.scrollTo(0, from + (to - from) * e);
        if (k < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    })`);
  }

  async glideTo(text: string | RegExp, ms = 1600, offset = 110) {
    const el = this.page.getByText(text).first();
    await el.waitFor({ timeout: 45_000 });
    const b = await el.boundingBox();
    if (b) await this.glideBy(b.y - offset, ms);
  }

  async go(path: string, waitFor?: string | RegExp) {
    await this.page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    if (waitFor) await this.page.getByText(waitFor).first().waitFor({ timeout: 60_000 });
    await this.page.waitForLoadState("load").catch(() => {});
  }
}

async function desktop(ctx: BrowserContext) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const rec = new Recorder(cdp);
  const d = new Driver(page);
  await page.goto(`${BASE}/offline`, { waitUntil: "domcontentloaded" });
  await page.mouse.move(640, 420);
  let graveId = Number(process.env.GRAVE_ID ?? 0) || 0;

  if (want("home")) {
    await d.go("/", "Bury the bag.");
    await sleep(2500); // fonts and the hero's first animation
    await rec.start("home");
    await sleep(2200);
    await d.moveTo(760, 380, 1400);
    await d.glideBy(520, 3200);
    await sleep(1200);
    await d.glideBy(560, 3000);
    await sleep(1200);
    await rec.stop();
  }

  if (want("bury")) {
    await d.go("/bury", "Lay it to rest.");
    await sleep(1500);
    await rec.start("bury");
    await sleep(1200);
    rec.mark("connect");
    await d.click(page.getByRole("button", { name: "Connect wallet" }), { settle: 900 });
    rec.mark("throwaway");
    await d.click(page.getByRole("button", { name: "Use a throwaway wallet" }), { settle: 1200 });
    rec.mark("claim");
    await d.click(page.getByRole("button", { name: "Claim test bags" }), { settle: 600 });
    await page.getByText("Test bags sent").waitFor({ timeout: 60_000 });
    const copium = page.getByRole("button", { name: /\$COPIUM/ });
    // Devnet RPCs can take a while to list new token accounts; reload the page if they're slow.
    for (let attempt = 0; ; attempt++) {
      try {
        await copium.waitFor({ timeout: 45_000 });
        break;
      } catch (e) {
        await page.screenshot({ path: join(RAW, `bury-wait-${attempt}.png`) });
        if (attempt >= 3) throw e;
        rec.mark(`reload${attempt}`);
        await page.reload({ waitUntil: "domcontentloaded" });
      }
    }
    rec.mark("bags");
    await sleep(800);
    await d.click(copium, { settle: 700 });
    await d.click(page.getByRole("button", { name: "All of it" }), { settle: 700 });
    rec.mark("prepare");
    await d.click(page.getByRole("button", { name: "Review burial" }), { settle: 300 });
    await page.getByText("Review the burial").waitFor({ timeout: 90_000 });
    rec.mark("review");
    await sleep(600);
    await d.glideTo("Review the burial", 1200, 90);
    await sleep(1200);
    await d.glideBy(330, 2600);
    await sleep(1000);
    const epitaph = page.locator("#epitaph");
    rec.mark("epitaph");
    await d.click(epitaph, { settle: 200 });
    await page.keyboard.type("Here lies my conviction. Again.", { delay: 65 });
    await sleep(500);
    rec.mark("sign");
    await d.click(page.getByRole("button", { name: "Sign and bury" }), { settle: 300 });
    await page.getByText("Interment in progress").waitFor({ timeout: 60_000 });
    rec.mark("interment");
    await d.glideTo("Interment in progress", 900, 150);
    await d.moveTo(1180, 640, 700); // park the cursor out of the way
    await page.getByText("NEAR MPC network verifying the deposit").waitFor({ timeout: 10_000 }).catch(() => {});
    await page.getByText("Here lies", { exact: true }).waitFor({ timeout: 240_000 });
    rec.mark("done");
    await d.glideTo("Here lies", 700, 120);
    await sleep(2800);
    const visit = page.getByRole("link", { name: "Visit your grave" });
    const href = await visit.getAttribute("href");
    graveId = Number(href?.split("/").pop());
    rec.mark("visit");
    await d.click(visit, { settle: 200 });
    await page.getByText("The grave’s account").waitFor({ timeout: 60_000 });
    rec.mark("gravepage");
    await sleep(1800);
    await d.glideTo("The grave’s account", 2200);
    rec.mark("account");
    await sleep(2400);
    await rec.stop();
    console.log(`  grave ${graveId}`);
    writeFileSync(join(RAW, "grave-id.txt"), String(graveId));
  }

  if (want("grave") && graveId) {
    await d.go(`/grave/${graveId}`, "The grave’s account");
    await sleep(2000);
    await rec.start("grave");
    await sleep(2200);
    await d.glideTo("The grave’s account", 2600);
    await sleep(2600);
    await d.glideTo("History", 2200);
    await sleep(2400);
    await rec.stop();
  }

  if (want("crypt") && graveId) {
    await d.go(`/crypt/${graveId}`, "Sign to enter");
    await sleep(1500);
    await rec.start("crypt");
    await sleep(1200);
    await d.click(page.getByRole("button", { name: "Sign to enter" }), { settle: 300 });
    await page.getByText("The door opened.").waitFor({ timeout: 60_000 });
    await sleep(1500);
    await d.glideTo("Holder’s statement", 2200);
    await sleep(2500);
    await rec.stop();
  }

  if (want("candle")) {
    await d.go("/grave/1", "Light a candle");
    await sleep(1500);
    await rec.start("candle");
    await sleep(900);
    await d.click(page.getByRole("button", { name: "Light a candle" }), { settle: 300 });
    await page.getByText("Your candle is lit").waitFor({ timeout: 60_000 }).catch(() => console.warn("  (candle: no confirmation seen)"));
    await sleep(2500);
    await rec.stop();
  }

  if (want("verify")) {
    await page.goto(`${BASE}/verify`, { waitUntil: "commit" });
    await rec.start("verify");
    await page.getByText(/11\/11 claims hold/).waitFor({ timeout: 120_000 });
    await sleep(1800);
    await d.glideBy(560, 3200);
    await sleep(1400);
    await d.glideBy(620, 3000);
    await sleep(1400);
    await rec.stop();
  }

  if (want("bones")) {
    await d.go("/bones");
    await sleep(3000);
    await rec.start("bones");
    await sleep(1500);
    await d.glideBy(620, 3000);
    await sleep(1600);
    await d.glideBy(700, 3000);
    await sleep(1600);
    await rec.stop();
  }

  if (want("market")) {
    await d.go("/grave/3", "Market read by NEAR MPC");
    await sleep(2000);
    await rec.start("market");
    await sleep(1200);
    await d.glideTo("Market read by NEAR MPC", 2400);
    await sleep(3500);
    await rec.stop();
  }

  if (want("sold")) {
    await d.go("/grave/5", "History");
    await sleep(2000);
    await rec.start("sold");
    await sleep(1000);
    await d.glideTo("The grave’s account", 2200);
    await sleep(2000);
    await d.glideTo("History", 2200);
    await sleep(3000);
    await rec.stop();
  }

  if (want("scan")) {
    await page.goto(`${BASE}/scan?address=${WALLET}&net=testnet`, { waitUntil: "commit" });
    await rec.start("scan");
    await page.getByText(/tokens? (are|is) dead|came back|tokens,/).first().waitFor({ timeout: 90_000 }).catch(() => {});
    await sleep(2500);
    await d.glideBy(420, 2600);
    await sleep(1800);
    await rec.stop();
  }

  if (want("obituary")) {
    await d.go(`/obituary/sol-devnet/${WALLET}`, "Share on X");
    await sleep(2500);
    await rec.start("obituary");
    await sleep(1500);
    await d.glideBy(300, 2400);
    await sleep(2200);
    await rec.stop();
  }

  if (want("cemetery")) {
    await d.go("/cemetery", "Rows of the departed.");
    await sleep(2500);
    await rec.start("cemetery");
    await sleep(1500);
    await d.glideTo("The boards", 2600);
    await sleep(2400);
    await d.glideTo("Fresh graves", 2400);
    await sleep(2000);
    await rec.stop();
  }

  return graveId;
}

async function mobile(ctx: BrowserContext, graveId: number) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const rec = new Recorder(cdp);
  const d = new Driver(page);
  if (want("m-home")) {
    await d.go("/", "Bury the bag.");
    await sleep(2500);
    await rec.start("m-home", 1170, 2532);
    await sleep(1800);
    await d.glideBy(700, 3200);
    await sleep(1500);
    await rec.stop();
  }
  if (want("m-grave") && graveId) {
    await d.go(`/grave/${graveId}`, "The grave’s account");
    await sleep(2500);
    await rec.start("m-grave", 1170, 2532);
    await sleep(1800);
    await d.glideTo("The grave’s account", 3000);
    await sleep(2500);
    await rec.stop();
  }
}

(async () => {
  mkdirSync(RAW, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await ctx.addInitScript(CURSOR);
  const graveId = await desktop(ctx);
  await ctx.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await mobile(phone, graveId || Number(process.env.GRAVE_ID ?? 0));
  await phone.close();
  await browser.close();
  console.log("\ndone");
})().catch((e) => {
  console.error("CAPTURE FAILED:", e);
  process.exit(1);
});
