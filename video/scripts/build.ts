/** Bundle the scenes for the renderer and index the captured footage. */
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

const meta: Record<string, unknown> = {};
const raw = join(ROOT, "footage-raw");
if (existsSync(raw)) {
  for (const clip of readdirSync(raw)) {
    const f = join(raw, clip, "frames.json");
    if (existsSync(f)) meta[clip] = JSON.parse(readFileSync(f, "utf8"));
  }
}
mkdirSync(join(ROOT, "public"), { recursive: true });
writeFileSync(join(ROOT, "public", "meta.json"), JSON.stringify(meta));
console.log(`footage: ${Object.keys(meta).join(", ") || "none"}`);

(async () => {
  await build({
    entryPoints: [join(ROOT, "src", "entry.tsx")],
    bundle: true,
    outdir: join(ROOT, "dist"),
    entryNames: "bundle",
    assetNames: "fonts/[name]-[hash]",
    publicPath: "/dist",
    loader: { ".woff2": "file", ".woff": "file" },
    jsx: "automatic",
    format: "esm",
    target: "chrome120",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: false,
    logLevel: "warning",
  });
  writeFileSync(
    join(ROOT, "render.html"),
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/dist/bundle.css"><style>html,body{margin:0;background:#090706;overflow:hidden}#root{width:1920px;height:1080px}</style></head><body><div id="root"></div><script type="module" src="/dist/bundle.js"></script></body></html>`,
  );
  console.log("built dist/bundle.js");
})();
