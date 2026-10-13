---
status: accepted
---

# The camera is opened at 4K and recorded at 1440p, despite repeated frames

Decided by Matt on 2026-10-13, after the repeated frames were diagnosed. Builds on the manual clap step of the **AV Calibration** (#2137, PR #2139).

## Context

The CVM **Recorder** opens the Cam Link 4K raw, which with this camera offers only two modes: 2160p29.97 or 1080p59.94. It uses 2160p29.97 and scales to 2560x1440 on the GPU, so no 4K reaches the disk (`apps/local/recorder-service/capture-args.ts`).

In 2160p29.97 mode, about 1 frame in 9 repeats the previous picture:

| Camera file                                                              | Repeated frames per 100 |
| ------------------------------------------------------------------------ | ----------------------- |
| AV Calibration 74995ba2                                                  | 10.5–12                 |
| AV Calibration 65dadb53                                                  | 10.5–12                 |
| AV Calibration 49dba2e5                                                  | about 0–1.5             |
| OBS, 1080p59.94, same camera (six recordings, 2026-10-12 and 2026-10-13) | about 0.1               |

So only about 26.5 distinct pictures arrive per second. No frame is dropped, so sound and picture never drift apart.

The repeats are there before scaling and encoding: the capture log's per-frame stats show exact zero-motion frames. They therefore come from the 4K capture path (the camera, the Cam Link or its driver), not from ffmpeg's timing, the fps filter or NVENC. The Cam Link is on a direct motherboard USB 3 port. OBS, opening the same camera at 1080p59.94, is clean.

The evidence (per-frame average-luma traces of each file) was in `/home/mattpocock/.claude/jobs/6171f7ae/tmp/obs-dup-check/` and `/home/mattpocock/.claude/jobs/6171f7ae/tmp/dup-diagnosis/`. That is scratch and will be gone; the table above is its summary.

## Decision

**The CVM Recorder keeps opening the Cam Link 4K in 2160p29.97 and recording the camera at 1440p, and accepts the repeated frames that mode delivers.**

- A repeat is a 33 ms hold in a talking head, which is hard to see.
- The repeats mattered mainly to automatic clap detection, and the clap step is now set by hand (#2137): nothing detects claps automatically any more.
- The 1440p picture leaves room to crop and zoom, for example the 9:16 crop of a **Short**, with more pixels to spare than a 1080p camera.

## Alternatives rejected

- **1080p59.94, as OBS does.** Clean, but a smaller picture to crop from. It is the fallback if the repeats ever become visible.
- **1080p29.97.** Smaller picture and the same frame rate, so no gain.
- **Re-timing frames with the device's timestamps.** The repeats arrive from the device as repeated pictures, so no re-timing can recover the missing ones.
- **Recording 4K to disk.** About twice the file size, a heavier load on the one NVENC, which is also encoding the screen, and slower renders, since 4K is decoded on the CPU. Revisit if Shorts crops ever need it.
- **A frame-check CLI** to count repeats in a camera file. Not worth building while the repeats are accepted.
- **Changing the camera's settings.** Matt will not touch the camera: it works for OBS.

## Consequences

- About 1 camera frame in 9 is a repeat, in **Footage** and in every **AV Calibration** camera file.
- Sound and picture stay in sync: a repeat replaces a picture; it never adds or drops one.
- This is a two-way door: switching to 1080p59.94 is one change in `capture-args.ts` (the camera input mode and the scale).
