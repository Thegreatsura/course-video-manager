---
status: accepted
supersedes: 0045-the-recorder-preview-is-an-h264-stream (decision 2 only)
---

# The recorder preview encodes on NVENC, falling back to libx264

Decided by Matt on 2026-10-14 (#2194), who approved the GPU for the previews. This replaces decision 2 of [ADR 0045](0045-the-recorder-preview-is-an-h264-stream.md) ("libx264 on the CPU, never NVENC"). The rest of ADR 0045 still holds.

## Decision

1. **Both previews encode with `h264_nvenc`, tuned for latency.** The settings are `p1`, `-tune ull`, `-zerolatency 1`, `-delay 0`, no B-frames, no lookahead, an IDR every second with no scene cuts, High profile, constant QP 21.
2. **Frames stay on the GPU.** The camera's `scale_cuda` output goes straight to NVENC. The screen's ddagrab frame is made NV12 with `scale_d3d11`, as the screen recorder does it. NVENC fed BGRA converts each frame itself and fell behind 60 fps (41-49 fps, synthetic).
3. **The recording gets its encoders first.** A preview-only process whose NVENC will not open (no free session, no usable GPU) moves that feed to libx264 until the service restarts, and the log says so. That failure does not count as one of the Cam Link's tries. During a take, the camera process carries the camera preview on that feed's encoder. A feed that already fell back never asks NVENC for a session inside a take.

## Consequences

- A take holds 4 NVENC sessions: camera.mkv, screen.mkv and the two previews. Exports add at most 2 (encode slots). Nine concurrent synthetic sessions opened on the RTX 4060 (driver 591.74).
- The preview's CPU cost drops from about 0.4 of a core per feed to under 0.1 (synthetic, Windows ffmpeg.exe).
- If the camera preview's NVENC fails _inside_ a take, the take's ffmpeg process fails with it. ffmpeg cannot drop one output's encoder. The fallback above makes that need a session to vanish between the preview opening and Record.
