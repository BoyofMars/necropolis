/**
 * public/music.wav → public/music.mka: the same 16-bit PCM in a Matroska
 * container (A_PCM/INT/LIT), which VLC reads on this machine when WAV won't.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const wav = readFileSync(join(ROOT, "public", "music.wav"));
const channels = wav.readUInt16LE(22);
const rate = wav.readUInt32LE(24);
const bits = wav.readUInt16LE(34);
const pcm = wav.subarray(44);
const frameBytes = (channels * bits) / 8;

const id = (hex: number) => {
  const b: number[] = [];
  let x = hex;
  while (x > 0) {
    b.unshift(x & 0xff);
    x = Math.floor(x / 256);
  }
  return Buffer.from(b);
};
/** 8-byte EBML size. */
const size8 = (n: number) => {
  const b = Buffer.alloc(8);
  b[0] = 0x01;
  let x = n;
  for (let i = 7; i >= 1; i--) {
    b[i] = x & 0xff;
    x = Math.floor(x / 256);
  }
  return b;
};
const el = (hex: number, data: Buffer) => Buffer.concat([id(hex), size8(data.length), data]);
const uint = (hex: number, v: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(v));
  return el(hex, b);
};
const str = (hex: number, s: string) => el(hex, Buffer.from(s, "ascii"));
const f64 = (hex: number, v: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v);
  return el(hex, b);
};

const header = el(0x1a45dfa3, Buffer.concat([uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, "matroska"), uint(0x4287, 4), uint(0x4285, 2)]));
const totalFrames = pcm.length / frameBytes;
const durationMs = (totalFrames / rate) * 1000;
const info = el(0x1549a966, Buffer.concat([uint(0x2ad7b1, 1_000_000), str(0x4d80, "necropolis"), str(0x5741, "necropolis"), f64(0x4489, durationMs)]));
const tracks = el(
  0x1654ae6b,
  el(0xae, Buffer.concat([uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 2), str(0x86, "A_PCM/INT/LIT"), el(0xe1, Buffer.concat([f64(0xb5, rate), uint(0x9f, channels), uint(0x6264, bits)]))])),
);

// One cluster per second, one block per 20 ms.
const clusters: Buffer[] = [];
const blockFrames = Math.round(rate * 0.02);
const clusterFrames = rate;
for (let c = 0; c < totalFrames; c += clusterFrames) {
  const blocks: Buffer[] = [uint(0xe7, Math.round((c / rate) * 1000))];
  for (let f = c; f < Math.min(c + clusterFrames, totalFrames); f += blockFrames) {
    const n = Math.min(blockFrames, totalFrames - f);
    const rel = Math.round(((f - c) / rate) * 1000);
    const head = Buffer.alloc(4);
    head[0] = 0x81; // track 1
    head.writeInt16BE(rel, 1);
    head[3] = 0x80; // keyframe
    blocks.push(el(0xa3, Buffer.concat([head, pcm.subarray(f * frameBytes, (f + n) * frameBytes)])));
  }
  clusters.push(el(0x1f43b675, Buffer.concat(blocks)));
}
const segment = el(0x18538067, Buffer.concat([info, tracks, ...clusters]));
const out = join(ROOT, "public", "music.mka");
writeFileSync(out, Buffer.concat([header, segment]));
console.log(`wrote ${out}: ${channels} ch, ${rate} Hz, ${bits}-bit, ${(durationMs / 1000).toFixed(2)} s`);
