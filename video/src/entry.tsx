import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "@fontsource/hanken-grotesk/800.css";
import "@fontsource/hanken-grotesk/900.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "@fontsource/cormorant-garamond/600-italic.css";
import "@fontsource/cormorant-garamond/700-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Video } from "./Video";

declare global {
  interface Window {
    __ready: Promise<void>;
    __seek: (frame: number) => Promise<void>;
  }
}

const root = createRoot(document.getElementById("root")!);

window.__ready = (async () => {
  const [meta, data] = await Promise.all([fetch("/public/meta.json").then((r) => r.json()), fetch("/public/data.json").then((r) => r.json())]);
  window.__META = meta;
  window.__DATA = data;
  // Load every weight we use before the first frame.
  const faces = ["400", "600", "700", "800", "900"].map((w) => `${w} 40px "Hanken Grotesk"`);
  faces.push('600 40px "Cormorant Garamond"', '700 40px "Cormorant Garamond"', 'italic 600 40px "Cormorant Garamond"', 'italic 700 40px "Cormorant Garamond"', '400 40px "JetBrains Mono"', '600 40px "JetBrains Mono"');
  await Promise.all(faces.map((f) => document.fonts.load(f)));
})();

window.__seek = async (frame: number) => {
  await window.__ready;
  flushSync(() => root.render(<Video frame={frame} />));
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)));
};
