# Recorder scorecard

Run 2026-10-30T04:20:45.698Z, full mode, commit `ca63ea73`, 1054 s. Long take 360 s; 50 Record/Stop cycles. Synthetic sources only (lavfi through the real ffmpeg.exe and the real recorder service).

The bar is the stricter of the target and OBS's value (CVM must be at least as good as OBS). Gap is how far past the bar, in each metric's own scale, so gaps rank across units.

## Gaps, worst first (15 failing, 1 unmeasured, 33 passing)

| #   | Metric                                                                                  | CVM         | Target   | OBS      | Bar      | Status   | Gap  |
| --- | --------------------------------------------------------------------------------------- | ----------- | -------- | -------- | -------- | -------- | ---- |
| 1   | Camera frames dropped in the long take (`camera_dropped_frames`)                        | 4006 frames | 0 frames | unknown  | 0 frames | **fail** | 4006 |
| 2   | Camera frames repeated per 100 (long take) (`camera_repeated_per_100`)                  | 36.65 /100  | 0.1 /100 | 0.1 /100 | 0.1 /100 | **fail** | 365  |
| 3   | Record press → first screen frame in screen.mkv (`record_to_first_screen_frame_ms`)     | 463 ms      | 100 ms   | unknown  | 100 ms   | **fail** | 11   |
| 4   | Camera preview latency, during a take (p95) (`preview_camera_take_p95_ms`)              | 185 ms      | 100 ms   | unknown  | 100 ms   | **fail** | 8.5  |
| 5   | Optimistic Clip delay (Take rule met → take-started heard) (`optimistic_clip_delay_ms`) | 620 ms      | 250 ms   | unknown  | 250 ms   | **fail** | 7.4  |
| 6   | Recorder CPU, recording (% of machine) (`cpu_recording_pct`)                            | 2.32 %      | 2 %      | 0.31 %   | 0.31 %   | **fail** | 4.02 |
| 7   | Camera preview latency, during a take (median) (`preview_camera_take_p50_ms`)           | 109 ms      | 70 ms    | unknown  | 70 ms    | **fail** | 3.9  |
| 8   | NVENC utilisation added by recording (`nvenc_recording_delta_pct`)                      | 60.93 pp    | 45 pp    | 42.7 pp  | 42.7 pp  | **fail** | 3.65 |
| 9   | Camera preview latency, idle (median) (`preview_camera_idle_p50_ms`)                    | 99 ms       | 70 ms    | unknown  | 70 ms    | **fail** | 2.9  |
| 10  | A/V drift (mic vs camera) across the long take (`av_drift_ms`)                          | 11.63 ms    | 10 ms    | 0.3 ms   | 0.3 ms   | **fail** | 2.27 |
| 11  | Cycles: Stop press → files finalised (p90) (`cycles_stop_final_p90_ms`)                 | 1178 ms     | 1000 ms  | unknown  | 1000 ms  | **fail** | 1.78 |
| 12  | Screen preview latency, during a take (p95) (`preview_screen_take_p95_ms`)              | 107 ms      | 100 ms   | 111 ms   | 100 ms   | **fail** | 0.7  |
| 13  | Longest camera preview gap around Record (`preview_gap_on_record_ms`)                   | 110 ms      | 100 ms   | unknown  | 100 ms   | **fail** | 0.3  |
| 14  | Longest camera preview gap around Stop (`preview_gap_on_stop_ms`)                       | 107 ms      | 100 ms   | unknown  | 100 ms   | **fail** | 0.21 |
| 15  | Service killed mid-take: seconds of camera lost (`crash_seconds_lost`)                  | 1.08 s      | 1 s      | unknown  | 1 s      | **fail** | 0.16 |

## All metrics

### Speed

| #   | Metric                                                                                  | CVM      | Target  | OBS     | Bar     | Status   | Gap  |
| --- | --------------------------------------------------------------------------------------- | -------- | ------- | ------- | ------- | -------- | ---- |
| 1   | Record press → first screen frame in screen.mkv (`record_to_first_screen_frame_ms`)     | 463 ms   | 100 ms  | unknown | 100 ms  | **fail** | 11   |
| 2   | Camera preview latency, during a take (p95) (`preview_camera_take_p95_ms`)              | 185 ms   | 100 ms  | unknown | 100 ms  | **fail** | 8.5  |
| 3   | Optimistic Clip delay (Take rule met → take-started heard) (`optimistic_clip_delay_ms`) | 620 ms   | 250 ms  | unknown | 250 ms  | **fail** | 7.4  |
| 4   | Camera preview latency, during a take (median) (`preview_camera_take_p50_ms`)           | 109 ms   | 70 ms   | unknown | 70 ms   | **fail** | 3.9  |
| 5   | Camera preview latency, idle (median) (`preview_camera_idle_p50_ms`)                    | 99 ms    | 70 ms   | unknown | 70 ms   | **fail** | 2.9  |
| 6   | Screen preview latency, during a take (p95) (`preview_screen_take_p95_ms`)              | 107 ms   | 100 ms  | 111 ms  | 100 ms  | **fail** | 0.7  |
| 7   | Longest camera preview gap around Record (`preview_gap_on_record_ms`)                   | 110 ms   | 100 ms  | unknown | 100 ms  | **fail** | 0.3  |
| 8   | Longest camera preview gap around Stop (`preview_gap_on_stop_ms`)                       | 107 ms   | 100 ms  | unknown | 100 ms  | **fail** | 0.21 |
| 9   | Record press → recorder says recording (`record_ack_ms`)                                | 26.37 ms | 100 ms  | unknown | 100 ms  | pass     |      |
| 10  | Record press → first camera frame in camera.mkv (`record_to_first_camera_frame_ms`)     | 53 ms    | 100 ms  | unknown | 100 ms  | pass     |      |
| 11  | Record press → first mic sound in mic.mkv (`record_to_first_mic_ms`)                    | 69.92 ms | 100 ms  | unknown | 100 ms  | pass     |      |
| 12  | Stop press → recorder open again (UI unlocked) (`stop_to_open_ms`)                      | 0.7 ms   | 500 ms  | unknown | 500 ms  | pass     |      |
| 13  | Stop press → next command answered (`stop_to_next_command_ms`)                          | 1.25 ms  | 500 ms  | unknown | 500 ms  | pass     |      |
| 14  | Stop press → take files finalised (recording-stopped) (`stop_to_files_final_ms`)        | 833 ms   | 1000 ms | unknown | 1000 ms | pass     |      |
| 15  | Screen preview latency, idle (median) (`preview_screen_idle_p50_ms`)                    | 42 ms    | 70 ms   | unknown | 70 ms   | pass     |      |
| 16  | Screen preview latency, during a take (median) (`preview_screen_take_p50_ms`)           | 54 ms    | 70 ms   | 89 ms   | 70 ms   | pass     |      |
| 17  | Longest screen preview gap around Record (`screen_preview_gap_on_record_ms`)            | 84.81 ms | 100 ms  | unknown | 100 ms  | pass     |      |
| 18  | Clip end delay (silence long enough → speech-ended heard) (`clip_end_delay_ms`)         | 78.5 ms  | 250 ms  | unknown | 250 ms  | pass     |      |

### Reliability

| #   | Metric                                                                                                       | CVM         | Target   | OBS      | Bar      | Status     | Gap  |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------- | -------- | -------- | -------- | ---------- | ---- |
| 1   | Camera frames dropped in the long take (`camera_dropped_frames`)                                             | 4006 frames | 0 frames | unknown  | 0 frames | **fail**   | 4006 |
| 2   | Camera frames repeated per 100 (long take) (`camera_repeated_per_100`)                                       | 36.65 /100  | 0.1 /100 | 0.1 /100 | 0.1 /100 | **fail**   | 365  |
| 3   | A/V drift (mic vs camera) across the long take (`av_drift_ms`)                                               | 11.63 ms    | 10 ms    | 0.3 ms   | 0.3 ms   | **fail**   | 2.27 |
| 4   | Cycles: Stop press → files finalised (p90) (`cycles_stop_final_p90_ms`)                                      | 1178 ms     | 1000 ms  | unknown  | 1000 ms  | **fail**   | 1.78 |
| 5   | Service killed mid-take: seconds of camera lost (`crash_seconds_lost`)                                       | 1.08 s      | 1 s      | unknown  | 1 s      | **fail**   | 0.16 |
| 6   | Disk full mid-take (`disk_full`)                                                                             | —           | yes      | unknown  | yes      | unmeasured |      |
| 7   | Screen frames dropped in the long take (`screen_dropped_frames`)                                             | 0 frames    | 0 frames | unknown  | 0 frames | pass       |      |
| 8   | Screen frames repeated per 100 (long take) (`screen_repeated_per_100`)                                       | 0 /100      | 0.1 /100 | unknown  | 0.1 /100 | pass       |      |
| 9   | Frames the service itself reports lost (long take) (`service_frames_lost`)                                   | 0 frames    | 0 frames | unknown  | 0 frames | pass       |      |
| 10  | Screen frames the service itself reports lost (long take) (`service_screen_frames_lost`)                     | 0 frames    | 0 frames | unknown  | 0 frames | pass       |      |
| 11  | Screen lag drift across the long take (`screen_lag_drift_ms`)                                                | 6.33 ms     | 10 ms    | unknown  | 10 ms    | pass       |      |
| 12  | Service killed mid-take: files playable (`crash_files_playable`)                                             | 3 of 3      | 3 of 3   | unknown  | 3 of 3   | pass       |      |
| 13  | Service killed mid-take: take recovered on restart (`crash_take_recovered`)                                  | yes         | yes      | unknown  | yes      | pass       |      |
| 14  | Service killed mid-take: restart → recovered (`crash_recovery_ms`)                                           | 4622 ms     | 15000 ms | unknown  | 15000 ms | pass       |      |
| 15  | Preview killed → recording unaffected: pass rate over the runs (`preview_kill_pass_rate_pct`)                | 100 %       | 100 %    | unknown  | 100 %    | pass       |      |
| 16  | Writer reconnect at Stop: capture lives through it (pass rate over the cycles) (`stop_capture_survival_pct`) | 100 %       | 100 %    | unknown  | 100 %    | pass       |      |
| 17  | Camera capture process restarts per Stop (`capture_restarts_per_stop`)                                       | 0 /stop     | 0 /stop  | unknown  | 0 /stop  | pass       |      |
| 18  | Preview killed mid-take: camera.mkv frames lost (worst run) (`preview_kill_take_frames_lost`)                | 0 frames    | 0 frames | unknown  | 0 frames | pass       |      |
| 19  | Preview killed mid-take: every run carries on and stops cleanly (`preview_kill_take_ok`)                     | yes         | yes      | unknown  | yes      | pass       |      |
| 20  | Preview killed: kill → preview frames again (median run) (`preview_kill_recovery_ms`)                        | 1752 ms     | 3000 ms  | unknown  | 3000 ms  | pass       |      |
| 21  | Back-to-back Record/Stop cycles that failed (`cycles_failed`)                                                | 0 cycles    | 0 cycles | unknown  | 0 cycles | pass       |      |
| 22  | ffmpeg.exe processes left over after the cycles (`cycles_leaked_processes`)                                  | 0 procs     | 0 procs  | unknown  | 0 procs  | pass       |      |
| 23  | Memory growth across the cycles (`cycles_memory_growth_mb`)                                                  | 17.1 MB     | 20 MB    | unknown  | 20 MB    | pass       |      |
| 24  | Cycles: Record press → recording (p90) (`cycles_record_ack_p90_ms`)                                          | 32.89 ms    | 150 ms   | unknown  | 150 ms   | pass       |      |
| 25  | Event log write fails mid-take: take stops with playable files (`event_log_failure_stops_cleanly`)           | yes         | yes      | unknown  | yes      | pass       |      |

### Resources

| #   | Metric                                                                                     | CVM      | Target  | OBS     | Bar     | Status   | Gap  |
| --- | ------------------------------------------------------------------------------------------ | -------- | ------- | ------- | ------- | -------- | ---- |
| 1   | Recorder CPU, recording (% of machine) (`cpu_recording_pct`)                               | 2.32 %   | 2 %     | 0.31 %  | 0.31 %  | **fail** | 4.02 |
| 2   | NVENC utilisation added by recording (`nvenc_recording_delta_pct`)                         | 60.93 pp | 45 pp   | 42.7 pp | 42.7 pp | **fail** | 3.65 |
| 3   | Recorder CPU, open and idle (% of machine) (`cpu_idle_pct`)                                | 1.53 %   | 2 %     | unknown | 2 %     | pass     |      |
| 4   | Recorder memory, recording (ffmpeg.exe working sets + service RSS) (`memory_recording_mb`) | 1141 MB  | 1500 MB | unknown | 1500 MB | pass     |      |
| 5   | GPU utilisation added by recording (vs before the service) (`gpu_recording_delta_pct`)     | 39.17 pp | 50 pp   | unknown | 50 pp   | pass     |      |
| 6   | GPU memory added by recording (`vram_recording_delta_mb`)                                  | 845 MB   | 1700 MB | unknown | 1700 MB | pass     |      |

## OBS evidence

- `camera_repeated_per_100`: ADR 0042: OBS repeats about 0.1 per 100 at 1080p59.94 (real Cam Link)
- `cpu_recording_pct`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS process avg 0.31% of 32 logical CPUs (CPU was waived by Matt in #1993)
- `nvenc_recording_delta_pct`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS NVENC avg 42.7% (whole GPU)
- `av_drift_ms`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS audio − camera trend 0.3 ms over 30 min
- `preview_screen_take_p95_ms`: #1993 rig, OBS 30-min baseline (2026-10-11): p95 111 ms
- `preview_screen_take_p50_ms`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS Virtual Camera screen path p50 89 ms, recording

Every other OBS value is unknown: the repo has no measurement of it (no OBS start/stop latency, finalisation time, idle preview latency, crash recovery, cycle or disk-full data).

## Notes

- `camera_dropped_frames`: Read from each frame's burned-in index, never its clock: a starved synthetic source stamps late frames back to back (`sourceStalls` in the details).
- `camera_repeated_per_100`: The synthetic camera never repeats a frame itself; the real Cam Link at 4K does (ADR 0042, ~11 per 100).
- `cpu_recording_pct`: Includes generating the synthetic sources. Matt waived CPU in #1993.
- `nvenc_recording_delta_pct`: OBS's figure is the whole GPU while OBS recorded the real rig.
- `av_drift_ms`: Absolute change from the first minute to the last.
- `preview_gap_on_record_ms`: OBS: prose only (its preview never reopens).
- `disk_full`: Not simulated: a size-limited or throttled filesystem needs root, and the footage drive must never be filled.
- `stop_to_files_final_ms`: OBS: the rig only bounds it (StopRecord → file stable ≤ 8 s, including a 5 s settle wait): not a measurement.
- `cpu_idle_pct`: Includes generating the synthetic sources (lavfi, geq) inside the capture processes.
- `gpu_recording_delta_pct`: Whole-GPU reading less the reading before the service started; anything else on the GPU moves it.
- `vram_recording_delta_mb`: OBS's rig run used 1662 MiB of VRAM on the whole GPU (not a delta), so it is not a reference here.
- `screen_dropped_frames`: Read from each frame's burned-in index, never its clock: a starved synthetic source stamps late frames back to back (`sourceStalls` in the details).
- `preview_kill_pass_rate_pct`: A run passes when the take stops cleanly on request with no frame of camera.mkv lost.
- Footage is written to WSL's own disk (ffmpeg.exe reaches it over \\wsl.localhost), never to a Windows drive; Matt's footage goes to a Windows drive, so finalisation times here include the WSL file share.
- A/V drift is measured over the long take (360 s, real time), first minute against last.
- Every Windows process ran through the Windows guard (Idle priority, cores 6-9), checked every 5 s; timer-resolution.ps1 was not run (it raises the capture, writer and screen recorder to High).
- GPU before the service started: 0% busy, NVENC 0%, 1558 MiB.
- Merged from 3 runs (--only, each one service start, in order): idle, longTake; previewKill, eventLogFailure, crash; cycles. Full-mode cycles and fault repeats; the long take is 360 s, not 600 s, so each part fits an agent's 600 s foreground limit.
