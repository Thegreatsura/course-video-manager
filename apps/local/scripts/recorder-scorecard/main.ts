/**
 * THE RECORDER SCORECARD: drives the real CVM recorder service end to end
 * on synthetic sources and scores it on speed and reliability against its
 * targets and OBS (docs/recorder-scorecard/README.md).
 *
 *   pnpm recorder:scorecard [--quick] [--out <dir>] [--long-take <s>]
 *     [--cycles <n>] [--keep-footage] [--wait-minutes <n>]
 *
 * Writes `scorecard.json` and `scorecard.md` to `--out` (default
 * `.data/recorder-scorecard/<run>/`). Opens no capture device and no real
 * screen; never touches OBS or Matt's own recorder service, and waits while
 * that one is recording (and stops if it starts).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MIC_NAME } from "../../app/mic-device";
import { RECORDER_CAMERA_NAME } from "../../app/av-calibration-constants";
import { cycles, crash } from "./faults";
import type { Measured } from "./metrics";
import { openPreviewProbe } from "./preview-probe";
import { renderJson, renderMarkdown, type RunInfo } from "./report";
import { eventLogFailure, idle, longTake, previewKill } from "./scenarios";
import { connect, isState, startService } from "./service-control";
import { SYNTHETIC_THRESHOLD_DB } from "./synthetic-sources";
import { openRecorder, sleep, watchFeeds, type Ctx } from "./takes";
import {
  killMarked,
  liveRecorderState,
  logicalCpus,
  sampleGpu,
} from "./windows";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const quick = args.includes("--quick");
const longTakeSeconds = Number(flag("--long-take") ?? (quick ? 60 : 600));
const cycleCount = Number(flag("--cycles") ?? (quick ? 10 : 50));
const waitMinutes = Number(flag("--wait-minutes") ?? 30);
const keepFootage = args.includes("--keep-footage");

const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
const marker = `cvm-scorecard-${runId}`;
const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const outDir = path.resolve(
  flag("--out") ?? path.join(repoRoot, ".data/recorder-scorecard", runId)
);
const workDir = path.join(os.tmpdir(), `cvm-recorder-scorecard-${runId}`);

const log = (line: string) =>
  console.log(`[scorecard ${new Date().toISOString().slice(11, 19)}] ${line}`);

/** Nothing the scorecard writes may land on a Windows drive. */
const refuseMnt = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir);
  if (real.startsWith("/mnt/"))
    throw new Error(`Refusing to write under /mnt: ${dir} is ${real}`);
};
refuseMnt(outDir);
refuseMnt(workDir);
const stateDir = path.join(workDir, "state");
const footageDir = path.join(workDir, "footage");
fs.mkdirSync(footageDir, { recursive: true });

class Aborted extends Error {}
let aborted = false;

/**
 * Waits while Matt's recorder records (up to `--wait-minutes`, then gives
 * up), and for a while if it is merely open: two recorders share one GPU.
 * Says whether it was still open when the run started.
 */
const waitForIdleRecorder = async () => {
  const deadline = Date.now() + waitMinutes * 60_000;
  const openDeadline = Date.now() + Math.min(waitMinutes, 5) * 60_000;
  for (;;) {
    const state = await liveRecorderState();
    if (state === "closed") return false;
    if (state === "open" && Date.now() > openDeadline) return true;
    if (Date.now() > deadline)
      throw new Error(
        `Matt's recorder was still recording after ${waitMinutes} min: not run.`
      );
    log(`Matt's recorder is ${state}: waiting`);
    await sleep(15_000);
  }
};

const main = async () => {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const measured: Measured = {};
  const details: Record<string, unknown> = {
    errors: {} as Record<string, string>,
  };
  const notes: string[] = [
    "Footage is written to WSL's own disk (ffmpeg.exe reaches it over \\\\wsl.localhost), never to a Windows drive; Matt's footage goes to a Windows drive, so finalisation times here include the WSL file share.",
    `A/V drift is measured over the long take (${longTakeSeconds} s, real time), first minute against last.`,
  ];

  if (await waitForIdleRecorder())
    notes.push(
      "Matt's own recorder was open (not recording) for this run, so the GPU was shared with his previews: preview latency, repeats and GPU figures read worse than on an idle machine."
    );
  const guard = setInterval(() => {
    void liveRecorderState().then((s) => {
      if (s === "recording" && !aborted) {
        aborted = true;
        log("Matt's recorder started recording: stopping the scorecard");
      }
    });
  }, 5000);

  const gpuProbe = sampleGpu();
  await sleep(3000);
  const gpuBefore = gpuProbe.stop();
  if (gpuBefore)
    notes.push(
      `GPU before the service started: ${Math.round(gpuBefore.gpuPct)}% busy, NVENC ${Math.round(gpuBefore.encoderPct)}%, ${Math.round(gpuBefore.memoryMb)} MiB.`
    );
  const cpus = await logicalCpus();
  log(`run ${runId}: service starting (marker ${marker})`);
  const service = await startService({
    marker,
    stateDir,
    logFile: path.join(workDir, "service.log"),
  });
  const client = await connect(service.port);
  const hello = await client.waitFor((m) => m.type === "hello", {
    what: "hello",
  });
  if (hello.message.type === "hello" && !hello.message.ffmpeg.ok)
    throw new Error(`ffmpeg.exe refused: ${hello.message.ffmpeg.message}`);

  const ctx: Ctx = {
    marker,
    stateDir,
    footageDir,
    videoId: `scorecard-${runId}`,
    calibration: {
      id: `scorecard-${runId}`,
      createdAtMs: Date.now(),
      thresholdDb: SYNTHETIC_THRESHOLD_DB,
      recorderMic: MIC_NAME,
      browserInputLabel: null,
      cameraDevice: RECORDER_CAMERA_NAME,
    },
    service,
    client,
    feeds: watchFeeds(service.port),
    probe: undefined,
    cpus,
    measured,
    details,
    log,
    checkAbort: () => {
      if (aborted) throw new Aborted("Matt's recorder started recording");
    },
  };
  details.openToLiveMs = await openRecorder(ctx);
  log(`camera live after ${Math.round(details.openToLiveMs as number)} ms`);
  try {
    ctx.probe = await openPreviewProbe(service.port);
  } catch (e) {
    notes.push(
      `Preview latency not measured: the browser did not start (${e instanceof Error ? e.message.split("\n")[0] : String(e)}).`
    );
  }
  await sleep(4000);

  const scenarios: [string, () => Promise<void>][] = [
    ["idle", () => idle(ctx, gpuBefore)],
    ["longTake", () => longTake(ctx, longTakeSeconds, gpuBefore)],
    ["previewKill", () => previewKill(ctx, quick ? 12 : 20)],
    ["eventLogFailure", () => eventLogFailure(ctx)],
    ["cycles", () => cycles(ctx, cycleCount)],
    [
      "crash",
      async () => {
        await ctx.probe?.close();
        ctx.probe = undefined;
        await crash(ctx);
      },
    ],
  ];
  for (const [name, run] of scenarios) {
    if (aborted) break;
    try {
      await run();
    } catch (e) {
      if (e instanceof Aborted) break;
      log(`${name} failed: ${e instanceof Error ? e.stack : String(e)}`);
      (details.errors as Record<string, string>)[name] =
        e instanceof Error ? e.message.slice(0, 2000) : String(e);
      // A take left recording is stopped before the next scenario.
      ctx.client.send({ type: "stop" });
      await sleep(3000);
    }
  }

  log("closing");
  clearInterval(guard);
  await ctx.probe?.close();
  try {
    const from = ctx.client.send({ type: "stop" });
    await sleep(1000);
    ctx.client.send({ type: "close" });
    await ctx.client.waitFor(isState("closed"), {
      from: from.from,
      timeoutMs: 30_000,
    });
  } catch (e) {
    log(`close: ${e instanceof Error ? e.message : String(e)}`);
  }
  ctx.client.close();
  ctx.feeds.camera.close();
  ctx.feeds.screen.close();
  await ctx.service.stop();
  details.leftoverProcesses = await killMarked(marker);
  if (aborted)
    notes.push(
      "ABORTED: Matt's recorder started recording, so the run stopped early; unmeasured metrics are blank."
    );

  const run: RunInfo = {
    startedAt,
    mode: quick ? "quick" : "full",
    commit,
    longTakeSeconds,
    cycles: cycleCount,
    wallSeconds: (performance.now() - started) / 1000,
    notes,
  };
  fs.writeFileSync(
    path.join(outDir, "scorecard.json"),
    renderJson(run, measured, details)
  );
  fs.writeFileSync(
    path.join(outDir, "scorecard.md"),
    renderMarkdown(run, measured)
  );
  log(`report: ${path.join(outDir, "scorecard.md")}`);
};

try {
  await main();
} finally {
  // Whatever happened, nothing of this run is left running on Windows.
  await killMarked(marker).catch(() => 0);
  if (!keepFootage) fs.rmSync(workDir, { recursive: true, force: true });
  else log(`footage kept in ${workDir}`);
}
process.exit(0);
