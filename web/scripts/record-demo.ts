/**
 * Record a captioned demo of the live app (WebM, 1280×720) with Playwright.
 * Every scene is the real deployment reading real chain state: nothing is
 * mocked. A browser without a wallet can't sign a burial, so the burial and
 * payouts are shown through graves the E2E runs created (see README).
 *
 *   npx tsx scripts/record-demo.ts [https://necropolis-wine.vercel.app]
 *   → demo/necropolis-demo.webm
 *
 * With FFMPEG=<path to ffmpeg> it also writes demo/necropolis-demo.mp4 for X:
 * H.264 + AAC, 30 fps, fast start, with the warm-up before scene 1 cut off.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "https://necropolis-wine.vercel.app";
const OUT = join(process.cwd(), "demo");
const WALLET = "9wZiympr3GJQrqHyHW7TPEpFApVx7S4ZAHwbfhzxqibN"; // devnet test wallet from the E2E runs
const NORMIE = "0x47b464eDB8Dc9BC67b5CD4C9310BB87b773845bD"; // a real dead Base memecoin
const SCENES = 10;

/** Caption bar, rendered from sessionStorage on every page load so it's there from first paint. */
const CAPTION_SCRIPT = `(() => {
  const draw = () => {
    const raw = sessionStorage.getItem("demo:caption");
    if (!raw || !document.body) return;
    const c = JSON.parse(raw);
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;padding:56px 48px 26px;background:linear-gradient(180deg,rgba(12,11,10,0) 0,rgba(12,11,10,.97) 44px,rgba(12,11,10,.98) 100%);font-family:Georgia,serif;";
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div style="font:600 11px/1 system-ui,sans-serif;letter-spacing:.32em;color:#8e8676;text-transform:uppercase">Necropolis · ' + c.step + ' / ${SCENES}</div>' +
      '<div style="margin-top:8px;font-size:34px;line-height:1.1;color:#ece6d8">' + c.title + '</div>' +
      (c.sub ? '<div style="margin-top:6px;font:italic 19px/1.35 Georgia,serif;color:#f0a63c;max-width:980px">' + c.sub + '</div>' : '') +
      '<div style="margin-top:14px;height:2px;background:#2c2924"><div style="height:2px;width:' + (c.step / ${SCENES} * 100) + '%;background:#f0a63c"></div></div>';
  };
  document.addEventListener("DOMContentLoaded", draw);
  window.addEventListener("load", draw);
  setTimeout(draw, 50);
})();`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A still of how the previous scene ended, for reviewing the video without a player. */
async function still(page: Page, step: number) {
  if (step > 1) await page.screenshot({ path: join(OUT, "frames", `scene-${step - 1}.png`) }).catch(() => {});
}

async function scene(page: Page, step: number, path: string, title: string, sub: string, waitFor?: string | RegExp) {
  await still(page, step);
  await page.evaluate((c) => sessionStorage.setItem("demo:caption", JSON.stringify(c)), { step, title, sub }).catch(() => {});
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  if (waitFor) await page.getByText(waitFor).first().waitFor({ timeout: 45_000 }).catch(() => console.warn(`  (scene ${step}: "${waitFor}" not seen)`));
  console.log(`scene ${step}: ${title}`);
}

/**
 * Smooth scroll to an element (or by pixels), at reading pace. Passed as a
 * string: tsx would otherwise wrap inner functions in a `__name` helper that
 * doesn't exist in the page.
 */
async function glide(page: Page, to: string | number, ms = 1600) {
  await page.evaluate(`new Promise((done) => {
    const to = ${JSON.stringify(to)}, ms = ${ms};
    let target = window.scrollY;
    if (typeof to === "number") target = window.scrollY + to;
    else {
      const el = [...document.querySelectorAll("h1,h2,h3,div,span,p")].find((e) => e.textContent && e.textContent.trim() === to);
      if (el) target = el.getBoundingClientRect().top + window.scrollY - 110;
    }
    const from = window.scrollY, t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      window.scrollTo(0, from + (target - from) * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2));
      if (k < 1) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  })`);
}

(async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "frames"), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
    colorScheme: "dark",
  });
  await ctx.addInitScript(CAPTION_SCRIPT);
  const page = await ctx.newPage();
  const recordingStarted = Date.now();
  await page.goto(`${BASE}/offline`, { waitUntil: "domcontentloaded" }); // same origin, so sessionStorage works from scene 1

  await scene(page, 1, "/", "A graveyard for dead memecoins.", "Bury a dead bag on its own chain, in a vault only a NEAR contract can open. If it comes back, you get 80% back. Burying also mints $BONES.", "Bury the bag.");
  await page.waitForLoadState("load").catch(() => {});
  const introSkip = (Date.now() - recordingStarted) / 1000; // the warm-up page, cut from the MP4
  await sleep(5000);
  await glide(page, 200, 1400);
  await sleep(2500);

  // Lead with the strongest proof: a rising judged on numbers NEAR MPC read from a real pool.
  await scene(page, 2, "/grave/3", "NEAR MPC as the coroner.", "This plot rose on liquidity and market cap that NEAR's MPC network read from a real Raydium pool on Solana. The coroner couldn't fake them.", "Market read by NEAR MPC");
  await sleep(2000);
  await glide(page, "The rite", 1800);
  await sleep(3500);
  await glide(page, "Market read by NEAR MPC", 1600);
  await sleep(4500);

  await scene(page, 3, "/grave/4", "$BONES: supply follows the dead.", "This $LAZARUS burial minted 110 BONES. When the coin rose, they burned, and its tithe paid everyone who held BONES at that moment.", "$BONES minted");
  await sleep(4000);
  await glide(page, 140, 1200); // keep "$BONES minted · burned" on screen
  await sleep(4000);

  await scene(page, 4, "/grave/1", "The graves that stay dead get paid.", "This $COPIUM grave never rose. Other coins' risings paid it, signed by the ossuary's MPC key. Now its BONES do the same.", "Ossuary shares");
  await sleep(2500);
  await glide(page, "Ossuary shares", 1800);
  await sleep(4000);

  await scene(page, 5, `/scan?address=${WALLET}&net=testnet`, "Who died in your wallet?", "Every token gets a death score from its market data. Here, a devnet test wallet.", /tokens? (are|is) dead|came back|tokens,/);
  await sleep(4500);

  await scene(page, 6, `/obituary/sol-devnet/${WALLET}`, "Share the obituary.", "One headstone per dead coin. The coins that came back glow.", "Share on X");
  await sleep(2500);
  await glide(page, 260, 1400);
  await sleep(3000);

  await scene(page, 7, `/token/base/${NORMIE}`, "Real autopsies, live mainnet data.", "Cause of death, time of death, and the evidence behind them.", "Death score");
  await sleep(3000);
  await glide(page, 520, 2000);
  await sleep(2500);

  await scene(page, 8, "/cemetery", "Candles, signed by wallets.", "Any Solana or EVM wallet lights one per grave. The NEAR contract checks the signature and keeps the count.", "Most mourned");
  await sleep(1500);
  await glide(page, "The boards", 1800);
  await sleep(4000);

  await scene(page, 9, "/proof", "Don't trust us. Check.", "Re-derive every vault address in your browser and match it against NEAR's MPC network, live.", "Check it");
  await page.locator("li span", { hasText: "✓" }).nth(3).waitFor({ timeout: 30_000 }).catch(() => {});
  await sleep(2500);
  await page.locator("li span", { hasText: "✓" }).first().scrollIntoViewIfNeeded().catch(() => {});
  await glide(page, 180, 1200);
  await sleep(4000);

  await scene(page, 10, "/", "Bury your bag. Keep the upside.", "necropolis-wine.vercel.app · $BONES · NEAR Chain Signatures · Solana · Base", "Bury the bag.");
  await sleep(4500);
  await still(page, SCENES + 1);

  const video = page.video();
  await ctx.close();
  await browser.close();
  const path = await video!.path();
  const webm = join(OUT, "necropolis-demo.webm");
  renameSync(path, webm);
  console.log(`\nwrote ${webm}`);

  if (process.env.FFMPEG) {
    const mp4 = join(OUT, "necropolis-demo.mp4");
    const r = spawnSync(
      process.env.FFMPEG,
      [
        ...["-hide_banner", "-loglevel", "error", "-y", "-ss", introSkip.toFixed(2), "-i", webm],
        ...["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-shortest", "-map", "0:v:0", "-map", "1:a:0"],
        ...["-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-r", "30"],
        ...["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", mp4],
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw new Error("ffmpeg failed");
    console.log(`wrote ${mp4} (intro trimmed ${introSkip.toFixed(1)}s)`);
  }
})().catch((e) => {
  console.error("RECORDING FAILED:", e.message);
  process.exit(1);
});
