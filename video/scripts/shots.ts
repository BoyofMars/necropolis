/**
 * Product screenshots of the live app for the launch thread, dark theme.
 * Each one is cropped to 16:9 around the panel(s) that make the post's point
 * and rendered at 3× so the small print stays readable on a phone.
 *
 *   npx tsx scripts/shots.ts [name ...]   → out/shots/<name>.png
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const BASE = "https://necropolis-wine.vercel.app";
const OUT = join(__dirname, "..", "out", "shots");

type Shot = {
  name: string;
  path: string;
  waitFor: string | RegExp;
  /** Text of headings whose panels the crop must contain. */
  panels: string[];
  /** If the panels are taller than 16:9 allows, keep the top. */
  top?: boolean;
  pad?: number;
  padTop?: number;
  shiftY?: number;
  then?: (p: Page) => Promise<void>;
};

const SHOTS: Shot[] = [
  { name: "2-proof", path: "/grave/9", waitFor: "The grave’s account", panels: ["Proof"] },
  { name: "3-market", path: "/grave/3", waitFor: "Market read by NEAR MPC", panels: ["Market read by NEAR MPC", "Risen."] },
  { name: "4-bones", path: "/bones", waitFor: "The rules, as the contract states them", panels: ["$BONES", "The rules, as the contract states them", "Parameters"], top: true, padTop: 70 },
  { name: "5-account", path: "/grave/5", waitFor: "The grave’s account", panels: ["The grave’s account", "History"], shiftY: -24 },
  { name: "6-verify", path: "/verify", waitFor: /11\/11 claims hold/, panels: ["Don’t trust us.", "11/11 claims hold"], top: true, padTop: 70 },
  {
    name: "7-no-wallet",
    path: "/bury",
    waitFor: "Lay it to rest.",
    panels: ["=Connect a wallet", "No wallet, or not on devnet?"],
    pad: 36,
    then: async (p) => {
      await p.getByRole("button", { name: "Connect wallet" }).click();
      await p.getByRole("button", { name: "Use a throwaway wallet" }).waitFor();
    },
  },
];

/** The bordered panel around each heading (or the heading itself), in page coordinates. */
async function panelBoxes(page: Page, texts: string[]) {
  return page.evaluate(`(() => {
    const texts = ${JSON.stringify(texts)};
    const all = [...document.querySelectorAll("h1,h2,h3,div,span,p,dt")];
    return texts.map((t) => {
      const norm = (s) => s.replace(/['’]/g, "'").trim();
      // "=Text" means the element itself, not its panel.
      const exact = t.startsWith("=");
      if (exact) t = t.slice(1);
      const el = all.find((e) => e.textContent && norm(e.textContent) === norm(t) && e.children.length === 0) || all.find((e) => e.textContent && norm(e.textContent) === norm(t));
      if (!el) return null;
      let p = el;
      while (!exact && p && p !== document.body) {
        const cs = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        if (parseFloat(cs.borderTopWidth) >= 1 && r.width > 280 && cs.position !== "fixed") break;
        if (cs.position === "fixed" && r.width > 280) break;
        p = p.parentElement;
      }
      const target = !exact && p && p !== document.body ? p : el;
      const r = target.getBoundingClientRect();
      let f = target, fixed = false;
      while (f && f !== document.body) { if (getComputedStyle(f).position === "fixed") { fixed = true; break; } f = f.parentElement; }
      return { x: r.left + (fixed ? 0 : scrollX), y: r.top + (fixed ? 0 : scrollY), w: r.width, h: r.height, fixed };
    });
  })()`) as Promise<({ x: number; y: number; w: number; h: number; fixed: boolean } | null)[]>;
}

(async () => {
  const only = process.argv.slice(2);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--hide-scrollbars"] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 3, colorScheme: "dark" });
  const page = await ctx.newPage();
  for (const s of SHOTS) {
    if (only.length && !only.includes(s.name)) continue;
    await page.goto(`${BASE}${s.path}`, { waitUntil: "domcontentloaded" });
    await page.getByText(s.waitFor).first().waitFor({ timeout: 90_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    if (s.then) await s.then(page);
    await page.waitForTimeout(2500);
    const boxes = (await panelBoxes(page, s.panels)).filter((b): b is NonNullable<typeof b> => !!b);
    if (boxes.length === 0) throw new Error(`${s.name}: no panels found`);
    const pad = s.pad ?? 28;
    let x0 = Math.min(...boxes.map((b) => b.x)) - pad;
    let y0 = Math.min(...boxes.map((b) => b.y)) - (s.padTop ?? pad);
    let x1 = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
    let y1 = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
    // Grow to 16:9 around the panels (or from their top), within the page width.
    let w = x1 - x0;
    let h = y1 - y0;
    if (w / h < 16 / 9) {
      if (s.top) h = Math.min(h, w * (9 / 16));
      w = Math.max(w, h * (16 / 9));
    }
    h = w * (9 / 16);
    const cx = (x0 + x1) / 2;
    x0 = Math.max(0, Math.min(1200 - w, cx - w / 2));
    if (w > 1200) {
      w = 1200;
      h = w * (9 / 16);
      x0 = 0;
    }
    const cy = (y0 + y1) / 2;
    y0 = (s.top ? y0 : Math.max(0, cy - h / 2)) + (s.shiftY ?? 0);
    // Bring the region into view, then shoot it relative to the viewport.
    const fixed = boxes.some((b) => b.fixed);
    if (!fixed) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, y0 - 80));
      await page.waitForTimeout(600);
    }
    const sy = fixed ? 0 : await page.evaluate(() => window.scrollY);
    const vh = page.viewportSize()!.height;
    if (y0 - sy + h > vh) await page.setViewportSize({ width: 1200, height: Math.ceil(y0 - sy + h + 10) });
    await page.screenshot({ path: join(OUT, `${s.name}.png`), clip: { x: x0, y: y0 - sy, width: w, height: h } });
    await page.setViewportSize({ width: 1200, height: 760 });
    console.log(`${s.name}: ${Math.round(w)}×${Math.round(h)} css → ${Math.round(w * 3)}×${Math.round(h * 3)} px`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
