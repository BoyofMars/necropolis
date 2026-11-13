/**
 * Render the video frame by frame in headless Chromium.
 *
 *   npx tsx scripts/render.ts --stills 120,600,1200     → out/stills/<frame>.png (to review)
 *   npx tsx scripts/render.ts [--from 0 --to 6600] [--draft]  → out/video.webm (VP9, then scripts/mux.ps1)
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium, type Page } from "playwright-core";
import { TOTAL_FRAMES } from "../src/timeline";

const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "out");
const FFMPEG = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "ffmpeg-1013", "ffmpeg-win64.exe");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };

function serve(): Promise<number> {
  const server = createServer((req, res) => {
    const p = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^([/\\])+/, "");
    const file = join(ROOT, p || "render.html");
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "max-age=3600" });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
}

async function openPage(port: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://127.0.0.1:${port}/render.html`);
  await page.evaluate(() => window.__ready);
  return page;
}

declare global {
  interface Window {
    __ready: Promise<void>;
    __seek: (frame: number) => Promise<void>;
  }
}

let browser: Awaited<ReturnType<typeof chromium.launch>>;

(async () => {
  const port = await serve();
  browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--force-color-profile=srgb", "--hide-scrollbars"] });

  const stills = arg("stills");
  if (stills) {
    const page = await openPage(port);
    mkdirSync(join(OUT, "stills"), { recursive: true });
    for (const f of stills.split(",").map(Number)) {
      await page.evaluate((x) => window.__seek(x), f);
      await page.screenshot({ path: join(OUT, "stills", `${String(f).padStart(5, "0")}.png`) });
      console.log(`still ${f}`);
    }
    await browser.close();
    process.exit(0);
  }

  const from = Number(arg("from") ?? 0);
  const to = Number(arg("to") ?? TOTAL_FRAMES);
  const draft = process.argv.includes("--draft");
  const workers = Number(arg("workers") ?? 3);
  mkdirSync(OUT, { recursive: true });
  const out = join(OUT, arg("out") ?? "video.webm");
  const ff = spawn(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", "60", "-c:v", "mjpeg", "-i", "pipe:0",
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "0", "-crf", draft ? "30" : "12",
      "-deadline", draft ? "realtime" : "good", "-cpu-used", draft ? "8" : "3", "-row-mt", "1", "-tile-columns", "2", "-threads", "8",
      "-g", "120", out,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise<void>((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));

  const pages = await Promise.all(Array.from({ length: workers }, () => openPage(port)));
  const ready = new Map<number, Buffer>();
  let next = from;
  let written = from;
  const t0 = Date.now();

  const write = async () => {
    while (ready.has(written)) {
      const buf = ready.get(written)!;
      ready.delete(written);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      written++;
      if ((written - from) % 300 === 0) {
        const fps = (written - from) / ((Date.now() - t0) / 1000);
        console.log(`${written}/${to}  ${fps.toFixed(1)} fps  ETA ${((to - written) / fps / 60).toFixed(1)} min`);
      }
    }
  };

  await Promise.all(
    pages.map(async (page) => {
      while (next < to) {
        const f = next++;
        await page.evaluate((x) => window.__seek(x), f);
        ready.set(f, await page.screenshot({ type: "jpeg", quality: draft ? 85 : 96 }));
        // Keep the reorder buffer small.
        while (ready.size > workers * 6 && !ready.has(written)) await new Promise((r) => setTimeout(r, 5));
        await write();
      }
    }),
  );
  await write();
  ff.stdin.end();
  await done;
  await browser.close();
  console.log(`\nwrote ${out} (${to - from} frames in ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
