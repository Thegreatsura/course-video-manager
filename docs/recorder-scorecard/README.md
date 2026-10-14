# Recorder scorecard

`pnpm recorder:scorecard` drives the real CVM recorder service end to end and scores its speed and reliability. Each metric has a target and an OBS reference, and the rule is that CVM must be at least as good as OBS on every metric. It writes `scorecard.json` and `scorecard.md`, with the gaps ranked worst first (#2212).

```sh
pnpm recorder:scorecard            # full: 10-min take, 50 Record/Stop cycles, ~15 min
pnpm recorder:scorecard --quick    # 60 s take, 10 cycles, ~4 min
  [--out <dir>]          # default .data/recorder-scorecard/<run>/
  [--long-take <s>] [--cycles <n>] [--keep-footage] [--wait-minutes <n>]
```

The command runs under `nice -n 19 taskset -c 6-9`. The baseline is in [`baseline/`](./baseline/). To compare a run with it, diff the two `scorecard.json` files: each metric sits on its own line, in a fixed order. The `ranking` list names the failing metrics, worst first.

## What it runs

- **Service.** The real service (`startRecorderService`) runs in a process of its own. It uses its own port and state folder, and real ffmpeg.exe with NVENC. The only thing swapped is the launcher (`scripts/recorder-scorecard/synthetic-launcher.ts`), which rewrites inputs and fakes listings:
  - The Cam Link becomes a 320x180 lavfi picture, made 4K NV12 on the GPU.
  - The mic becomes a lavfi tone bed with a 2.5 s burst every 6 s.
  - The DELL becomes a lavfi picture made 1080p in D3D11.
  - Every picture burns in its own Windows capture time.
  - The device and screen listings are faked.
- **Never touched.** No real device or screen is opened, OBS is never touched, and nothing is written under `/mnt`.
- **Process kills.** Every ffmpeg.exe the run starts carries a marker. Process kills match that marker only; Matt's own recorder uses the same tags, so the real `stop-recorders.ps1` is never run.
- **Matt's recorder.** The run waits while Matt's own recorder (port 5177) is recording, and stops if it starts recording. It also waits up to 5 minutes for that recorder to close, because both recorders share one GPU. If it is still open after that, the run goes ahead and the report says so.
- **Scenarios, in order:**
  1. Idle (preview latency and resources).
  2. The long take (A/V drift, frames, first frames, Stop timings, Optimistic Clip delay).
  3. A take whose camera and screen previews are killed mid-take.
  4. A take whose `events.jsonl` turns read-only.
  5. The Record/Stop cycles.
  6. The service SIGKILLed mid-take and started again on the same state folder.

## Reading it

- **Bar and gap.** A metric's **bar** is the stricter of its target and its OBS value. **Gap** is how far past the bar it is, measured in the metric's own `scale` (`metrics.ts`), so gaps in ms, frames and % rank together.
- **OBS values.** These come only from evidence in the repo: the #1993 rig's 30-minute OBS baseline, ADR 0042, #2207 and #2208. Everywhere else the OBS value is `unknown`, never a guess. Add one to `metrics.ts` only with its source.
- **Not simulated.** Disk-full and slow-disk are not simulated: either would need root for a size-limited filesystem, and could fill the footage drive. The scorecard does simulate a disk write failure, by making the event log read-only.
- **Synthetic sources.** The synthetic camera never repeats frames, but the real Cam Link does (ADR 0042). CPU figures include the cost of making the synthetic pictures.
- **Footage location.** Footage goes to WSL's own disk, while Matt's real footage goes to a Windows drive. Finalisation times therefore include the `\\wsl.localhost` share.

## For an agent fixing the worst gap

1. Run `--quick` to iterate, then run the full mode to confirm.
2. Pick the first id in `ranking` and fix it in the recorder.
3. Re-run, and commit the new `baseline/` alongside the fix.

A gap caused by the harness itself (the synthetic sources, or the clock reads) is fixed in `scripts/recorder-scorecard/`, never by moving a target.
