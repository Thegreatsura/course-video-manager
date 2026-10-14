import { isPlayable, playable } from "./footage-analysis";
import { connect, startService } from "./service-control";
import {
  hold,
  openRecorder,
  recordTake,
  rssMb,
  sleep,
  watchFeeds,
  type Ctx,
} from "./takes";
import { sampleMarked, windowsClockOffset } from "./windows";

/**
 * Back-to-back cycles, and the service killed mid-take.
 */

const percentile = (xs: number[], q: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

/** What the run's own processes hold: how many ffmpeg.exe, and memory with the service's. */
const footprint = async (ctx: Ctx) => {
  const s = await sampleMarked(ctx.marker);
  return {
    ffmpegProcesses: s.processes.length,
    memoryMb:
      s.processes.reduce((sum, p) => sum + p.workingSet, 0) / (1024 * 1024) +
      rssMb(ctx.service.child.pid),
  };
};

/** `n` Record/Stop cycles, each a short take, with a short rest between. */
export const cycles = async (ctx: Ctx, n: number) => {
  ctx.log(`cycles: ${n} back-to-back Record/Stop`);
  await sleep(2000);
  const before = await footprint(ctx);
  const acks: number[] = [];
  const finals: number[] = [];
  const failures: string[] = [];
  for (let i = 0; i < n; i++) {
    ctx.checkAbort();
    try {
      const take = await recordTake(ctx, () => hold(ctx, 1000), {
        stopTimeoutMs: 30_000,
      });
      acks.push(take.ackMs);
      finals.push(take.stopToFinalMs);
      if (take.stopped.reason !== "requested")
        failures.push(`cycle ${i + 1}: stopped ${take.stopped.reason}`);
    } catch (e) {
      failures.push(
        `cycle ${i + 1}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`
      );
      await sleep(3000);
    }
    await sleep(1000);
  }
  await sleep(3000);
  const after = await footprint(ctx);
  ctx.measured.cycles_failed = failures.length;
  ctx.measured.cycles_leaked_processes = Math.max(
    0,
    after.ffmpegProcesses - before.ffmpegProcesses
  );
  ctx.measured.cycles_memory_growth_mb = after.memoryMb - before.memoryMb;
  ctx.measured.cycles_record_ack_p90_ms = percentile(acks, 0.9);
  ctx.measured.cycles_stop_final_p90_ms = percentile(finals, 0.9);
  ctx.details.cycles = {
    n,
    failures,
    before,
    after,
    recordAckMs: {
      p50: percentile(acks, 0.5),
      p90: percentile(acks, 0.9),
      max: percentile(acks, 1),
    },
    stopToFinalMs: {
      p50: percentile(finals, 0.5),
      p90: percentile(finals, 0.9),
      max: percentile(finals, 1),
    },
    firstTenAckMs: acks.slice(0, 10).map(Math.round),
    lastTenAckMs: acks.slice(-10).map(Math.round),
  };
};

/**
 * The service SIGKILLed mid-take, as a crash ends it, then started again on
 * the same state folder: it must stop what the dead one left running,
 * repair the files and report the Recording Session recovered.
 */
export const crash = async (ctx: Ctx) => {
  ctx.log("crash: the service killed mid-take, then started again");
  await sleep(2000);
  const offset = await windowsClockOffset();
  let killWin = 0;
  let take:
    | {
        id: string;
        t0Ms: number;
        files: { camera: string; screen: string; mic: string };
      }
    | undefined;
  await recordTake(ctx, async (t) => {
    take = t;
    await hold(ctx, 6000);
    killWin = Date.now() + offset;
    await ctx.service.kill();
    throw new Error("killed");
  }).catch((e: unknown) => {
    if (!(e instanceof Error && e.message === "killed")) throw e;
  });
  if (!take) throw new Error("The crash take never started");
  ctx.client.close();
  ctx.feeds.camera.close();
  ctx.feeds.screen.close();
  // A moment as a person takes to notice and restart `pnpm dev`.
  await sleep(2000);
  const restartAt = performance.now();
  ctx.service = await startService({
    marker: ctx.marker,
    stateDir: ctx.stateDir,
    logFile: `${ctx.stateDir}/../service.log`,
  });
  ctx.client = await connect(ctx.service.port);
  ctx.feeds = watchFeeds(ctx.service.port);
  const hello = await ctx.client.waitFor((m) => m.type === "hello", {
    timeoutMs: 120_000,
    what: "hello after the restart",
  });
  const recovered =
    hello.message.type === "hello" && hello.message.recovered.includes(take.id);
  const files = {
    camera: playable(take.files.camera),
    screen: playable(take.files.screen),
    mic: playable(take.files.mic),
  };
  const expected = (killWin - take.t0Ms) / 1000;
  const lost =
    files.camera.durationSeconds === null
      ? expected
      : Math.max(0, expected - files.camera.durationSeconds);
  ctx.measured.crash_files_playable =
    Object.values(files).filter(isPlayable).length;
  ctx.measured.crash_take_recovered = recovered ? 1 : 0;
  ctx.measured.crash_seconds_lost = lost;
  ctx.measured.crash_recovery_ms = hello.at - restartAt;
  ctx.details.crash = {
    recordingSessionId: take.id,
    secondsRecordedBeforeKill: expected,
    files,
    recovered: hello.message.type === "hello" ? hello.message.recovered : [],
  };
  // The restarted service opens again, as the editor would.
  await openRecorder(ctx);
};
