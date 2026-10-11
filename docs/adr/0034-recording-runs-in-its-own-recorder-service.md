---
status: accepted
---

# Recording runs in its own recorder service

Today OBS records every **Video**, and the app reads the file it writes. The new recorder (PRD #1994, decisions in #1993) replaces OBS for Videos that choose it: ffmpeg.exe 8.0.1 on Windows records the camera, the screen and the mic as three files for one **Recording Session**, on one shared clock. Something has to start those ffmpeg processes, hold them while a Recording Session runs, read their silence detection, and stop them cleanly. This ADR records where that runs.

## Decision

1. **Recording runs in the recorder service, a small long-running process of its own in WSL** (`apps/local/recorder-service/`), in the same family as the Stream Deck forwarder and the Clip Mockup daemon ([ADR 0031](0031-clip-mockups-are-written-in-batches-through-a-local-daemon.md)). Not in the app server, and not in the **Sidecar**.
2. **It must survive both the app server and the Sidecar restarting.** A Recording Session runs for as long as Matt films, often an hour or more. In that time the app server restarts on a code change or a crash, and the Sidecar restarts with it under `pnpm dev`. Either one owning the ffmpeg processes would end the take mid-sentence. So `pnpm dev` and `pnpm start` start the service only when it is not already running, detached (`ensure-recorder-service.ts`), and never stop or restart it. Only Matt's main checkout starts it, as with the Stream Deck forwarder.
3. **It holds the camera only while the recorder is open for a Video.** Opening the recorder for a Video is what opens the Cam Link; closing it lets the device go, so OBS can still use it for an OBS Video. (This first slice opens the camera when a Recording Session starts; opening it when the recorder opens comes with the previews, #2002.)
4. **It never touches the database.** Its interface is one WebSocket (`protocol.ts`): open the recorder for a Video, record (with the **Silence Length** and a folder), stop, close, a stream of events, and a replay of a Recording Session's events after a given sequence number. Its durable record is each Recording Session's `events.jsonl` beside the Footage, every event numbered, so the app server, which writes the rows, can replay what it missed after its own restart and ingest each event once.
5. **One silence detector.** silencedetect runs inside the camera and mic process, on the mic audio that process writes, with the threshold and Silence Length the OBS path uses (`silence-detection-constants.ts`). Its speech events are in the mic file's time.
6. **ffmpeg 8.0.1 only.** At start-up the service refuses any other version with how to install it (`winget install Gyan.FFmpeg --version 8.0.1`, then `winget pin`). Newer builds need NVIDIA driver 610+ for NVENC. A change of NVIDIA driver since the last start only warns.

## Why not the Sidecar

[ADR 0032](0032-background-work-runs-in-the-sidecar.md) puts background work in the Sidecar: work the author starts and walks away from. Recording is not that. Matt watches it, it has no end he can predict, and it is tied to devices on his desk. The Sidecar restarts with the app under `pnpm dev`, and a **Job** that dies with it is retried, which a lost take cannot be. ADR 0032 stands: its section 7 names the recorder service among the processes that start other processes outside the Sidecar.

## Why not the app server

The app server restarts on every change to server code under `pnpm dev`. Holding ffmpeg there would end the take each time. A WebSocket from the app server to the service has no such cost: the socket drops, the app server reconnects, and it replays from the last sequence number it saw.

## Consequences

- The service runs whatever code it started with. Picking up a change to it means stopping it by hand (`kill <pid>`, which closes the files with `q` first); `pnpm dev` then starts the new code. It is never restarted for you, because that would stop a recording.
- Its tests drive it through its WebSocket with the process launcher (`launcher.ts`) as the only fake: a scripted ffmpeg.exe. The real Cam Link, the DELL, the mic and NVENC are not tested in CI. The rig (#1992) proved them, and Matt's first real Recording Sessions watch them.
- Its state is `.data/recorder-service/` (the last NVIDIA driver seen, an index of Recording Sessions for replay) and its log is `.data/logs/recorder-service.log`, both at the repository root.
- The app server's half is the **recorder client** (`apps/local/app/services/recorder-client/`): one WebSocket per app server process, opened on first use and kept across dev reloads. It sends Record and Stop for the editor, puts the service's events back in `seq` order per Recording Session (asking for a replay over a gap), and saves what each means: a `recording_session` row on start and stop, Clips when speech ends (`placeSpeechAsClips`, skipping a take that Recording Session already has, so a replay saves nothing twice). The editor hears what was saved over `GET /api/videos/:id/recorder/events`. Only the main checkout's app server connects to the service; any other gets the dead port, as with the Stream Deck hub.
