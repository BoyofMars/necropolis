/**
 * Measure picture-vs-sound offset in the final MP4 from the white flashes that
 * peak exactly on scene boundaries (10.000 s: the drop; 84.000 s and 92.000 s).
 * Seeks in 1/120 s steps and reports when the frame is brightest.
 *
 *   npx tsx scripts/sync.ts out/necropolis.mp4 10,84,92
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const file = resolve(process.argv[2] ?? "out/necropolis.mp4");
const cues = (process.argv[3] ?? "10,84,92").split(",").map(Number);
(async () => {
  const size = statSync(file).size;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/v.mp4")) {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : size - 1;
      res.writeHead(m ? 206 : 200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": end - start + 1, ...(m ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<body style="margin:0"><video id="v" src="/v.mp4" muted></video><canvas id="c" width="192" height="108"></canvas></body>`);
  });
  const port: number = await new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(`new Promise((r) => { const v = document.getElementById("v"); if (v.readyState >= 2) r(); else v.addEventListener("loadeddata", r, { once: true }); })`);
  for (const cue of cues) {
    let best = { t: 0, y: -1 };
    for (let i = -12; i <= 18; i++) {
      const t = cue + i / 120;
      const y = (await page.evaluate(`new Promise((r) => {
        const v = document.getElementById("v"), g = document.getElementById("c").getContext("2d");
        v.addEventListener("seeked", () => {
          g.drawImage(v, 0, 0, 192, 108);
          const d = g.getImageData(0, 0, 192, 108).data;
          let s = 0;
          for (let k = 0; k < d.length; k += 4) s += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
          r(s / (d.length / 4));
        }, { once: true });
        v.currentTime = ${t};
      })`)) as number;
      if (y > best.y + 0.01) best = { t, y };
    }
    console.log(`cue ${cue.toFixed(3)} s: brightest at ${best.t.toFixed(4)} s (luma ${best.y.toFixed(0)}) → picture offset ${((best.t - cue) * 1000).toFixed(0)} ms (±8)`);
  }
  await browser.close();
  server.close();
})();
