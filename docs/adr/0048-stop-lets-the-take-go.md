---
status: accepted
supersedes: 0047-the-recorder-holds-its-devices-open (decision 3's Stop, and the relays' NUT)
---

# Stop lets the take go; the relays survive a consumer coming back

Decided on 2026-10-14 (#2211), after Matt said: "Starting recording is now smooth, but ending recording is now not smooth."

## Context

After ADR 0047, every Stop still crashed the camera capture. Stop quit the take's writer, and the next writer armed on the same relay port. The capture's tee fifo then opened the relay again, and NUT's muxer cannot be opened twice. ffmpeg 8.0.1 on Windows exits with code 5 and 6.1 on Linux segfaults, and neither prints why. The service saw the capture go and reopened the Cam Link and the mic. On synthetic sources the preview froze for 0.6 s on every Stop. A stalled preview that was started again crashed the capture the same way, ending the take.

Stop also blocked the command queue until the take's files closed, so the editor showed "Stopping…" for 0.4-1 s. It sent `q` 250 ms after the press, whatever the writer's lag, so a writer running behind lost the end of the take.

## Decision

1. **The writer relay is Matroska, and the preview relay is bare rawvideo frames.** Both open again cleanly when a consumer comes back. Matroska carries the mic and the stamps the writer needs. It sends a frame only when the next packet comes, which the mic's 20 ms buffers keep short. The preview needs neither, and Matroska there cost a frame of latency (+35 ms median), so it gets bare frames and stamps them as they arrive.
2. **Stop opens the recorder again at the press.** The take finalises in the background: its last events, `recording-stopped` last, follow once its files are closed.
3. **The writer quits only once it has written past the press**, and no sooner than 250 ms after it. If it never gets there, it is quit after 5 s, and the take says how far short its files end.
4. **The next writer arms once the stopped take's writer has let the relay go.** A Record before then waits for it.

## Consequences

- On synthetic sources, the preview's longest frame gap across Stop is 40-65 ms, the same as idle. It was 582-637 ms. The capture never exits.
- The editor goes idle and can Record at once. The take's last `speech-ended` and `recording-stopped` now arrive after the status that says the recorder is open. The editor closes a take's audio window when its session ends mid-speech, and places the speech when its end arrives.
- A Record within about a second of Stop waits for the relay, then arms a writer on the spot.
- Closing the recorder, a calibration taking the Cam Link, and the service closing all wait for takes still finalising.
