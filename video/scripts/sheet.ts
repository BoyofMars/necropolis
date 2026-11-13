/** Contact sheets of out/stills, 4×4 per sheet, for reviewing a render at a glance. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const DIR = join(__dirname, "..", "out", "stills");
(async () => {
  const files = readdirSync(DIR).filter((f) => /^\d+\.png$/.test(f)).sort();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (let s = 0; s * 16 < files.length; s++) {
    const cells = files
      .slice(s * 16, s * 16 + 16)
      .map((f) => {
        const frame = Number(f.replace(".png", ""));
        const b64 = readFileSync(join(DIR, f)).toString("base64");
        return `<div style="position:relative"><img src="data:image/png;base64,${b64}" style="width:480px;height:270px;display:block"><span style="position:absolute;left:6px;top:4px;font:600 16px monospace;color:#fff;background:#000a;padding:1px 6px">${frame} · ${(frame / 60).toFixed(1)}s</span></div>`;
      })
      .join("");
    await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(4,480px)">${cells}</body>`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(DIR, `sheet-${s + 1}.png`) });
    console.log(`sheet-${s + 1}.png`);
  }
  await browser.close();
})();
