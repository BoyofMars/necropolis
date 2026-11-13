/** Minimal MP4 probe: tracks, codecs, durations and sample counts (no ffprobe here). */
import { readFileSync } from "node:fs";

const buf = readFileSync(process.argv[2]);
type Box = { type: string; start: number; end: number; body: number };
function boxes(start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    let body = p + 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8));
      body = p + 16;
    } else if (size === 0) size = end - p;
    out.push({ type, start: p, end: p + size, body });
    p += size;
  }
  return out;
}
const find = (list: Box[], type: string) => list.find((b) => b.type === type);
const top = boxes(0, buf.length);
console.log("top:", top.map((b) => `${b.type}(${((b.end - b.start) / 1e6).toFixed(2)}MB)`).join(" "));
const moov = find(top, "moov");
if (!moov) throw new Error("no moov");
const mvhd = find(boxes(moov.body, moov.end), "mvhd")!;
const v = buf[mvhd.body];
const ts = buf.readUInt32BE(mvhd.body + (v ? 20 : 12));
const dur = v ? Number(buf.readBigUInt64BE(mvhd.body + 24)) : buf.readUInt32BE(mvhd.body + 16);
console.log(`movie: ${(dur / ts).toFixed(2)} s`);
for (const trak of boxes(moov.body, moov.end).filter((b) => b.type === "trak")) {
  const mdia = find(boxes(trak.body, trak.end), "mdia")!;
  const kids = boxes(mdia.body, mdia.end);
  const mdhd = find(kids, "mdhd")!;
  const mv = buf[mdhd.body];
  const tts = buf.readUInt32BE(mdhd.body + (mv ? 20 : 12));
  const tdur = mv ? Number(buf.readBigUInt64BE(mdhd.body + 24)) : buf.readUInt32BE(mdhd.body + 16);
  const hdlr = find(kids, "hdlr")!;
  const handler = buf.toString("latin1", hdlr.body + 8, hdlr.body + 12);
  const minf = find(kids, "minf")!;
  const stbl = find(boxes(minf.body, minf.end), "stbl")!;
  const sk = boxes(stbl.body, stbl.end);
  const stsd = find(sk, "stsd")!;
  const codec = buf.toString("latin1", stsd.body + 12, stsd.body + 16);
  const stsz = find(sk, "stsz")!;
  const count = buf.readUInt32BE(stsz.body + 8);
  let extra = "";
  if (codec === "avc1") extra = ` ${buf.readUInt16BE(stsd.body + 8 + 32)}×${buf.readUInt16BE(stsd.body + 8 + 34)}`;
  if (codec === "mp4a") extra = ` ${buf.readUInt16BE(stsd.body + 8 + 24)} ch, ${buf.readUInt32BE(stsd.body + 8 + 32) >>> 16} Hz`;
  console.log(`track ${handler} ${codec}${extra}: ${(tdur / tts).toFixed(2)} s, ${count} samples${handler === "vide" ? `, ${(count / (tdur / tts)).toFixed(2)} fps` : ""}`);
}
