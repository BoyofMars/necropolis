/**
 * Decode the finished MP4 in Google Chrome (which plays H.264/AAC) and grab
 * frames at given times, to check the picture against the music's cues.
 *
 *   npx tsx scripts/check.ts out/necropolis.mp4 3.9,4.05,10.0
 */
import { createReadStream, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const file = resolve(process.argv[2]);
const times = (process.argv[3] ?? "0").split(",").map(Number);
const OUT = join(__dirname, "..", "out", "check");

(async () => {
  mkdirSync(OUT, { recursive: true });
  const size = statSync(file).size;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/v.mp4")) {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Number(range[2]) : size - 1;
      res.writeHead(range ? 206 : 200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": end - start + 1, ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<body style="margin:0;background:#000"><video id="v" src="/v.mp4" muted playsinline style="width:1920px;height:1080px;display:block"></video></body>`);
  });
  const port: number = await new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  // Strings, so tsx doesn't inject its __name helper into the page.
  const info = (await page.evaluate(`new Promise((r) => {
    const v = document.getElementById("v");
    const done = () => r({ duration: v.duration, w: v.videoWidth, h: v.videoHeight });
    if (v.readyState >= 1) done(); else v.addEventListener("loadedmetadata", done, { once: true });
  })`)) as { duration: number; w: number; h: number };
  console.log(`${basename(file)}: ${info.w}×${info.h}, ${info.duration.toFixed(3)} s (decoded by Chrome)`);
  for (const t of times) {
    await page.evaluate(`new Promise((r) => {
      const v = document.getElementById("v");
      v.addEventListener("seeked", () => requestAnimationFrame(() => requestAnimationFrame(() => r())), { once: true });
      v.currentTime = ${t};
    })`);
    const p = join(OUT, `t${t.toFixed(2)}.png`);
    await page.screenshot({ path: p });
    console.log(p);
  }
  await browser.close();
  server.close();
})();
