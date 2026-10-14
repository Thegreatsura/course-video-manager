---
status: accepted
---

# The recorder preview is an H.264 stream the browser decodes

Decided by Matt on 2026-10-14 (#2192): "It seems obvious to me that the recorder should send a video stream." Replaces the JPEG-per-frame preview of #2144.

## Context

The CVM recorder's live preview was a small MJPEG per feed: camera 640x360, screen 960x540, both at 30 fps and q7. The browser long-polled one JPEG at a time. It looked fuzzy beside OBS, judders against a 60 Hz display, and took about 90 ms from a frame being made to it being drawn (synthetic floor). A screen preview that stalled while still running froze the picture until `pnpm dev` restarted.

## Decision

1. **Each preview is a low-latency H.264 stream, full size.** The camera is at camera.mkv's 1440p. The screen is unscaled at 60 fps.
2. **Encoded by libx264 on the CPU, never NVENC.** It uses ultrafast + zerolatency, no B-frames and a keyframe every second. The recording's encoder budget stays the recording's.
3. **FLV from ffmpeg.exe to the service, relayed as it comes.** Each FLV tag carries its own length, so a frame goes on the moment its last byte arrives. A browser joining late starts at the last keyframe. A slow browser skips to the next keyframe rather than receive a backlog.
4. **The browser decodes with WebCodecs** (`VideoDecoder`, `optimizeForLatency`) and draws each `VideoFrame` on the composite canvas. It uses neither WebRTC (its jitter buffer adds latency, plus a dependency) nor MSE (its buffering adds latency).
5. **Every preview-only process has a watchdog.** No frame for 3 s, or an exit, and it is started again, its stderr kept in the log. The browser says a stalled feed is restarting instead of showing a frozen frame.

## Consequences

- About 0.3 of a core per preview for x264 on this machine's cores (synthetic, moving content). The camera's preview encode runs inside the recording process while recording.
- About 4-5 MB/s per feed for moving content over the localhost relay, against well under 2 MB/s for the old JPEGs. A static screen costs far less.
- The browser must have WebCodecs H.264 decode, which Chrome has.
