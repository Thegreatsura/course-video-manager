# Recorder scorecard

Run 2026-10-23T15:54:08.616Z, full mode, commit `f148af49`, 1303 s. Long take 600 s; 50 Record/Stop cycles. Synthetic sources only (lavfi through the real ffmpeg.exe and the real recorder service).

The bar is the stricter of the target and OBS's value (CVM must be at least as good as OBS). Gap is how far past the bar, in each metric's own scale, so gaps rank across units.

## Gaps, worst first (19 failing, 1 unmeasured, 29 passing)

| #   | Metric                                                                                  | CVM      | Target  | OBS     | Bar     | Status   | Gap   |
| --- | --------------------------------------------------------------------------------------- | -------- | ------- | ------- | ------- | -------- | ----- |
| 1   | Camera preview latency, during a take (p95) (`preview_camera_take_p95_ms`)              | 688 ms   | 100 ms  | unknown | 100 ms  | **fail** | 58.8  |
| 2   | Screen preview latency, during a take (p95) (`preview_screen_take_p95_ms`)              | 533 ms   | 100 ms  | 111 ms  | 100 ms  | **fail** | 43.3  |
| 3   | Camera preview latency, during a take (median) (`preview_camera_take_p50_ms`)           | 415 ms   | 70 ms   | unknown | 70 ms   | **fail** | 34.5  |
| 4   | Screen preview latency, during a take (median) (`preview_screen_take_p50_ms`)           | 363 ms   | 70 ms   | 89 ms   | 70 ms   | **fail** | 29.3  |
| 5   | A/V drift (mic vs camera) across the long take (`av_drift_ms`)                          | 122 ms   | 10 ms   | 0.3 ms  | 0.3 ms  | **fail** | 24.24 |
| 6   | Camera preview latency, idle (median) (`preview_camera_idle_p50_ms`)                    | 311 ms   | 70 ms   | unknown | 70 ms   | **fail** | 24.1  |
| 7   | Record press → first screen frame in screen.mkv (`record_to_first_screen_frame_ms`)     | 588 ms   | 100 ms  | unknown | 100 ms  | **fail** | 14.79 |
| 8   | Screen preview latency, idle (median) (`preview_screen_idle_p50_ms`)                    | 201 ms   | 70 ms   | unknown | 70 ms   | **fail** | 13.1  |
| 9   | Optimistic Clip delay (Take rule met → take-started heard) (`optimistic_clip_delay_ms`) | 851 ms   | 250 ms  | unknown | 250 ms  | **fail** | 12.03 |
| 10  | Screen lag drift across the long take (`screen_lag_drift_ms`)                           | 64 ms    | 10 ms   | unknown | 10 ms   | **fail** | 10.8  |
| 11  | Recorder CPU, recording (% of machine) (`cpu_recording_pct`)                            | 2.39 %   | 2 %     | 0.31 %  | 0.31 %  | **fail** | 4.16  |
| 12  | NVENC utilisation added by recording (`nvenc_recording_delta_pct`)                      | 60.77 pp | 45 pp   | 42.7 pp | 42.7 pp | **fail** | 3.61  |
| 13  | Cycles: Stop press → files finalised (p90) (`cycles_stop_final_p90_ms`)                 | 1207 ms  | 1000 ms | unknown | 1000 ms | **fail** | 2.07  |
| 14  | Stop press → take files finalised (recording-stopped) (`stop_to_files_final_ms`)        | 1158 ms  | 1000 ms | unknown | 1000 ms | **fail** | 1.58  |
| 15  | Recorder CPU, open and idle (% of machine) (`cpu_idle_pct`)                             | 2.6 %    | 2 %     | unknown | 2 %     | **fail** | 1.2   |
| 16  | Longest camera preview gap around Stop (`preview_gap_on_stop_ms`)                       | 128 ms   | 100 ms  | unknown | 100 ms  | **fail** | 0.86  |
| 17  | Longest screen preview gap around Record (`screen_preview_gap_on_record_ms`)            | 114 ms   | 100 ms  | unknown | 100 ms  | **fail** | 0.42  |
| 18  | Service killed mid-take: seconds of camera lost (`crash_seconds_lost`)                  | 1.13 s   | 1 s     | unknown | 1 s     | **fail** | 0.26  |
| 19  | Longest camera preview gap around Record (`preview_gap_on_record_ms`)                   | 104 ms   | 100 ms  | unknown | 100 ms  | **fail** | 0.13  |

## All metrics

### Speed

| #   | Metric                                                                                  | CVM      | Target  | OBS     | Bar     | Status   | Gap   |
| --- | --------------------------------------------------------------------------------------- | -------- | ------- | ------- | ------- | -------- | ----- |
| 1   | Camera preview latency, during a take (p95) (`preview_camera_take_p95_ms`)              | 688 ms   | 100 ms  | unknown | 100 ms  | **fail** | 58.8  |
| 2   | Screen preview latency, during a take (p95) (`preview_screen_take_p95_ms`)              | 533 ms   | 100 ms  | 111 ms  | 100 ms  | **fail** | 43.3  |
| 3   | Camera preview latency, during a take (median) (`preview_camera_take_p50_ms`)           | 415 ms   | 70 ms   | unknown | 70 ms   | **fail** | 34.5  |
| 4   | Screen preview latency, during a take (median) (`preview_screen_take_p50_ms`)           | 363 ms   | 70 ms   | 89 ms   | 70 ms   | **fail** | 29.3  |
| 5   | Camera preview latency, idle (median) (`preview_camera_idle_p50_ms`)                    | 311 ms   | 70 ms   | unknown | 70 ms   | **fail** | 24.1  |
| 6   | Record press → first screen frame in screen.mkv (`record_to_first_screen_frame_ms`)     | 588 ms   | 100 ms  | unknown | 100 ms  | **fail** | 14.79 |
| 7   | Screen preview latency, idle (median) (`preview_screen_idle_p50_ms`)                    | 201 ms   | 70 ms   | unknown | 70 ms   | **fail** | 13.1  |
| 8   | Optimistic Clip delay (Take rule met → take-started heard) (`optimistic_clip_delay_ms`) | 851 ms   | 250 ms  | unknown | 250 ms  | **fail** | 12.03 |
| 9   | Stop press → take files finalised (recording-stopped) (`stop_to_files_final_ms`)        | 1158 ms  | 1000 ms | unknown | 1000 ms | **fail** | 1.58  |
| 10  | Longest camera preview gap around Stop (`preview_gap_on_stop_ms`)                       | 128 ms   | 100 ms  | unknown | 100 ms  | **fail** | 0.86  |
| 11  | Longest screen preview gap around Record (`screen_preview_gap_on_record_ms`)            | 114 ms   | 100 ms  | unknown | 100 ms  | **fail** | 0.42  |
| 12  | Longest camera preview gap around Record (`preview_gap_on_record_ms`)                   | 104 ms   | 100 ms  | unknown | 100 ms  | **fail** | 0.13  |
| 13  | Record press → recorder says recording (`record_ack_ms`)                                | 29.45 ms | 100 ms  | unknown | 100 ms  | pass     |       |
| 14  | Record press → first camera frame in camera.mkv (`record_to_first_camera_frame_ms`)     | -41 ms   | 100 ms  | unknown | 100 ms  | pass     |       |
| 15  | Record press → first mic sound in mic.mkv (`record_to_first_mic_ms`)                    | -48 ms   | 100 ms  | unknown | 100 ms  | pass     |       |
| 16  | Stop press → recorder open again (UI unlocked) (`stop_to_open_ms`)                      | 1.46 ms  | 500 ms  | unknown | 500 ms  | pass     |       |
| 17  | Stop press → next command answered (`stop_to_next_command_ms`)                          | 2.25 ms  | 500 ms  | unknown | 500 ms  | pass     |       |
| 18  | Clip end delay (silence long enough → speech-ended heard) (`clip_end_delay_ms`)         | 184 ms   | 250 ms  | unknown | 250 ms  | pass     |       |

### Reliability

| #   | Metric                                                                                                       | CVM      | Target   | OBS      | Bar      | Status     | Gap   |
| --- | ------------------------------------------------------------------------------------------------------------ | -------- | -------- | -------- | -------- | ---------- | ----- |
| 1   | A/V drift (mic vs camera) across the long take (`av_drift_ms`)                                               | 122 ms   | 10 ms    | 0.3 ms   | 0.3 ms   | **fail**   | 24.24 |
| 2   | Screen lag drift across the long take (`screen_lag_drift_ms`)                                                | 64 ms    | 10 ms    | unknown  | 10 ms    | **fail**   | 10.8  |
| 3   | Cycles: Stop press → files finalised (p90) (`cycles_stop_final_p90_ms`)                                      | 1207 ms  | 1000 ms  | unknown  | 1000 ms  | **fail**   | 2.07  |
| 4   | Service killed mid-take: seconds of camera lost (`crash_seconds_lost`)                                       | 1.13 s   | 1 s      | unknown  | 1 s      | **fail**   | 0.26  |
| 5   | Disk full mid-take (`disk_full`)                                                                             | —        | yes      | unknown  | yes      | unmeasured |       |
| 6   | Camera frames dropped in the long take (`camera_dropped_frames`)                                             | 0 frames | 0 frames | unknown  | 0 frames | pass       |       |
| 7   | Camera frames repeated per 100 (long take) (`camera_repeated_per_100`)                                       | 0 /100   | 0.1 /100 | 0.1 /100 | 0.1 /100 | pass       |       |
| 8   | Screen frames dropped in the long take (`screen_dropped_frames`)                                             | 0 frames | 0 frames | unknown  | 0 frames | pass       |       |
| 9   | Screen frames repeated per 100 (long take) (`screen_repeated_per_100`)                                       | 0 /100   | 0.1 /100 | unknown  | 0.1 /100 | pass       |       |
| 10  | Frames the service itself reports lost (long take) (`service_frames_lost`)                                   | 0 frames | 0 frames | unknown  | 0 frames | pass       |       |
| 11  | Screen frames the service itself reports lost (long take) (`service_screen_frames_lost`)                     | 0 frames | 0 frames | unknown  | 0 frames | pass       |       |
| 12  | Service killed mid-take: files playable (`crash_files_playable`)                                             | 3 of 3   | 3 of 3   | unknown  | 3 of 3   | pass       |       |
| 13  | Service killed mid-take: take recovered on restart (`crash_take_recovered`)                                  | yes      | yes      | unknown  | yes      | pass       |       |
| 14  | Service killed mid-take: restart → recovered (`crash_recovery_ms`)                                           | 4386 ms  | 15000 ms | unknown  | 15000 ms | pass       |       |
| 15  | Preview killed → recording unaffected: pass rate over the runs (`preview_kill_pass_rate_pct`)                | 100 %    | 100 %    | unknown  | 100 %    | pass       |       |
| 16  | Writer reconnect at Stop: capture lives through it (pass rate over the cycles) (`stop_capture_survival_pct`) | 100 %    | 100 %    | unknown  | 100 %    | pass       |       |
| 17  | Camera capture process restarts per Stop (`capture_restarts_per_stop`)                                       | 0 /stop  | 0 /stop  | unknown  | 0 /stop  | pass       |       |
| 18  | Preview killed mid-take: camera.mkv frames lost (worst run) (`preview_kill_take_frames_lost`)                | 0 frames | 0 frames | unknown  | 0 frames | pass       |       |
| 19  | Preview killed mid-take: every run carries on and stops cleanly (`preview_kill_take_ok`)                     | yes      | yes      | unknown  | yes      | pass       |       |
| 20  | Preview killed: kill → preview frames again (median run) (`preview_kill_recovery_ms`)                        | 1863 ms  | 3000 ms  | unknown  | 3000 ms  | pass       |       |
| 21  | Back-to-back Record/Stop cycles that failed (`cycles_failed`)                                                | 0 cycles | 0 cycles | unknown  | 0 cycles | pass       |       |
| 22  | ffmpeg.exe processes left over after the cycles (`cycles_leaked_processes`)                                  | 0 procs  | 0 procs  | unknown  | 0 procs  | pass       |       |
| 23  | Memory growth across the cycles (`cycles_memory_growth_mb`)                                                  | -9.35 MB | 20 MB    | unknown  | 20 MB    | pass       |       |
| 24  | Cycles: Record press → recording (p90) (`cycles_record_ack_p90_ms`)                                          | 31.58 ms | 150 ms   | unknown  | 150 ms   | pass       |       |
| 25  | Event log write fails mid-take: take stops with playable files (`event_log_failure_stops_cleanly`)           | yes      | yes      | unknown  | yes      | pass       |       |

### Resources

| #   | Metric                                                                                     | CVM      | Target  | OBS     | Bar     | Status   | Gap  |
| --- | ------------------------------------------------------------------------------------------ | -------- | ------- | ------- | ------- | -------- | ---- |
| 1   | Recorder CPU, recording (% of machine) (`cpu_recording_pct`)                               | 2.39 %   | 2 %     | 0.31 %  | 0.31 %  | **fail** | 4.16 |
| 2   | NVENC utilisation added by recording (`nvenc_recording_delta_pct`)                         | 60.77 pp | 45 pp   | 42.7 pp | 42.7 pp | **fail** | 3.61 |
| 3   | Recorder CPU, open and idle (% of machine) (`cpu_idle_pct`)                                | 2.6 %    | 2 %     | unknown | 2 %     | **fail** | 1.2  |
| 4   | Recorder memory, recording (ffmpeg.exe working sets + service RSS) (`memory_recording_mb`) | 1175 MB  | 1500 MB | unknown | 1500 MB | pass     |      |
| 5   | GPU utilisation added by recording (vs before the service) (`gpu_recording_delta_pct`)     | 15.03 pp | 50 pp   | unknown | 50 pp   | pass     |      |
| 6   | GPU memory added by recording (`vram_recording_delta_mb`)                                  | 915 MB   | 1700 MB | unknown | 1700 MB | pass     |      |

## OBS evidence

- `preview_screen_take_p95_ms`: #1993 rig, OBS 30-min baseline (2026-10-11): p95 111 ms
- `preview_screen_take_p50_ms`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS Virtual Camera screen path p50 89 ms, recording
- `av_drift_ms`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS audio − camera trend 0.3 ms over 30 min
- `cpu_recording_pct`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS process avg 0.31% of 32 logical CPUs (CPU was waived by Matt in #1993)
- `nvenc_recording_delta_pct`: #1993 rig, OBS 30-min baseline (2026-10-11): OBS NVENC avg 42.7% (whole GPU)
- `camera_repeated_per_100`: ADR 0042: OBS repeats about 0.1 per 100 at 1080p59.94 (real Cam Link)

Every other OBS value is unknown: the repo has no measurement of it (no OBS start/stop latency, finalisation time, idle preview latency, crash recovery, cycle or disk-full data).

## Notes

- `av_drift_ms`: Absolute change from the first minute to the last.
- `cpu_recording_pct`: Includes generating the synthetic sources. Matt waived CPU in #1993.
- `nvenc_recording_delta_pct`: OBS's figure is the whole GPU while OBS recorded the real rig.
- `stop_to_files_final_ms`: OBS: the rig only bounds it (StopRecord → file stable ≤ 8 s, including a 5 s settle wait): not a measurement.
- `cpu_idle_pct`: Includes generating the synthetic sources (lavfi, geq) inside the capture processes.
- `preview_gap_on_record_ms`: OBS: prose only (its preview never reopens).
- `disk_full`: Not simulated: a size-limited or throttled filesystem needs root, and the footage drive must never be filled.
- `gpu_recording_delta_pct`: Whole-GPU reading less the reading before the service started; anything else on the GPU moves it.
- `vram_recording_delta_mb`: OBS's rig run used 1662 MiB of VRAM on the whole GPU (not a delta), so it is not a reference here.
- `camera_dropped_frames`: Read from each frame's burned-in index, never its clock: a starved synthetic source stamps late frames back to back (`sourceStalls` in the details).
- `camera_repeated_per_100`: The synthetic camera never repeats a frame itself; the real Cam Link at 4K does (ADR 0042, ~11 per 100).
- `screen_dropped_frames`: Read from each frame's burned-in index, never its clock: a starved synthetic source stamps late frames back to back (`sourceStalls` in the details).
- `preview_kill_pass_rate_pct`: A run passes when the take stops cleanly on request with no frame of camera.mkv lost.
- Footage is written to WSL's own disk (ffmpeg.exe reaches it over \\wsl.localhost), never to a Windows drive; Matt's footage goes to a Windows drive, so finalisation times here include the WSL file share.
- A/V drift is measured over the long take (600 s, real time), first minute against last.
- Every Windows process ran through the Windows guard (Idle priority, cores 6-9), checked every 5 s; timer-resolution.ps1 was not run (it raises the capture, writer and screen recorder to High).
- GPU before the service started: 0% busy, NVENC 0%, 1290 MiB.
