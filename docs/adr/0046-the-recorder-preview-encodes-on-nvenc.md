---
status: accepted
supersedes: 0045-the-recorder-preview-is-an-h264-stream (decision 2 only)
---

# The recorder preview encodes on NVENC, falling back to libx264

Decided by Matt on 2026-10-14 (#2194), who approved the GPU for the previews. This replaces decision 2 of [ADR 0045](0045-the-recorder-preview-is-an-h264-stream.md) ("libx264 on the CPU, never NVENC"). The rest of ADR 0045 still holds.

## Decision

1. **Both previews encode with `h264_nvenc`, tuned for latency.** The settings are `p1`, `-tune ull`, `-zerolatency 1`, `-delay 0`, no B-frames, no lookahead, an IDR every second with no scene cuts, High profile, constant QP 21.
2. **Frames stay on the GPU.** The camera's `scale_cuda` output goes straight to NVENC. The screen's ddagrab frame is made NV12 with `scale_d3d11`, as the screen recorder does it. NVENC fed BGRA converts each frame itself and fell behind 60 fps (41-49 fps, synthetic).
3. **A preview-only process falls back to libx264.** If its NVENC will not open (no free session, no usable GPU), that feed moves to libx264 until the service restarts, and the log says so. That failure does not count as one of the Cam Link's tries.
4. ~~**A take's camera preview has no encoder of its own (#2203).**~~ Superseded by [ADR 0047](0047-the-recorder-holds-its-devices-open.md): the camera preview is one process, the same recording or not, and camera.mkv is written by a process of its own. It is camera.mkv's own packets, teed to the feed. camera.mkv is written as before (no fifo, and a failure fails the take). The feed is behind the usual dropping, retrying fifo and is ignored when it fails. A preview problem cannot stop or change the Footage. ffmpeg cannot drop one output's failed encoder, so a second encoder in that process could. camera.mkv's NVENC runs at `-delay 1`, which gives the same packets but does not hold a queue of frames.

## Consequences

- A take holds 3 NVENC sessions: camera.mkv, screen.mkv and the screen preview. Exports add at most 2 (encode slots). Nine concurrent synthetic sessions opened on the RTX 4060 (driver 591.74).
- During a take, the camera preview is camera.mkv's picture: CFR, BT.709, with B-frames and a keyframe every 2 s. So it arrives a little later than the preview-only process's.
- The preview's CPU cost drops from about 0.4 of a core per feed to under 0.1 (synthetic, Windows ffmpeg.exe).
