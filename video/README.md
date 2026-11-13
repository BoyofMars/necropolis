# The demo video, made in code

A 110-second, 1080p60 video of Necropolis, built from the live app and real chain state. There is no stock footage, no mock-up and no licensed music.

| Part | How |
|---|---|
| **Footage** | [`web/scripts/capture-footage.ts`](../web/scripts/capture-footage.ts) drives production in Playwright. It records Chrome's screencast at 2× (2560×1440) with a drawn cursor. The burial is a real one: a throwaway devnet wallet claims test bags and buries $COPIUM, and the grave is minted on NEAR testnet in about 18 s. |
| **Picture** | React scenes in [`src/`](src) that are pure functions of the frame number ([`src/kit.ts`](src/kit.ts): easing, springs, keyframes). [`scripts/render.ts`](scripts/render.ts) steps every frame in headless Chromium and pipes the screenshots to ffmpeg (VP9). |
| **Sound** | [`music/compose.ts`](music/compose.ts) synthesises the whole track in TypeScript: kick, clap, hats, bass, pads, arpeggio, risers, a hospital-monitor beep and flatline, reverb and delay. It is written against the same bar grid as the picture ([`src/timeline.ts`](src/timeline.ts)), so cuts land on hits. |
| **Facts on screen** | Read from NEAR before rendering (`public/data.json`): the new grave's vault, deposit transaction, MPC payload hash and BONES. Every other figure comes from the README's live runs. |

## Run it

```bash
npm install
VIDEO_DIR=$PWD npx --prefix ../web tsx ../web/scripts/capture-footage.ts   # footage (spends a little testnet gas)
npx tsx music/compose.ts && npx tsx scripts/wav2mka.ts                    # soundtrack
npx tsx scripts/build.ts                                                  # bundle scenes, index footage
npx tsx scripts/render.ts --stills 600,2160,3840                          # spot-check frames
npx tsx scripts/render.ts                                                 # out/video.webm
powershell -File scripts/mux.ps1                                          # out/necropolis.mp4 (H.264 + AAC, via VLC)
```

On Windows, keep this folder on a short path: the toolchain's DLLs fail to load past 260 characters.
