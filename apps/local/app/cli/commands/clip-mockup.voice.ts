import {
  ConfigProvider,
  Effect,
  Layer,
  Logger,
  LogLevel,
  Option,
} from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { GitWorktreeProbeLive } from "@cvm/core/git-worktree";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { estimateSpokenSeconds } from "@cvm/core/features/clip-mockups/estimate-spoken-seconds";
import { CLIP_MOCKUP_VOICE_JOB_KIND } from "@cvm/core/features/clip-mockups/voice-status";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { loadRepoEnv } from "@/services/repo-env";
import { enqueueJob, JOB_KIND_SPECS } from "../../../sidecar/job-specs";

/**
 * THE VOICE HALF of `cvm clip-mockup add` and `update`, which no longer
 * waits for it. The rows are written with their voice `pending`; this queues
 * ONE `clip-mockup-voice` Job for them, which this machine's Sidecar runs
 * (`sidecar/kinds/clip-mockup-voice.ts`): Kokoro, through the Clip Mockup
 * daemon, never in the `cvm` process.
 */

/**
 * The Job row goes in this machine's database directly, as `cvm course
 * publish` does: the Sidecar reads its queue there, and the deployed API has
 * no Job verbs. The `Effect.serviceOption` branch is the test seam — a suite
 * provides `JobOperationsService` on its own database, and no connection is
 * opened from `.env`.
 */
const jobsLayer = JobOperationsService.Default.pipe(
  Layer.provide(
    DrizzleService.Default.pipe(Layer.provide(GitWorktreeProbeLive))
  )
);

const withJobOperations = <A, E>(
  effect: Effect.Effect<A, E, JobOperationsService>
) =>
  Effect.serviceOption(JobOperationsService).pipe(
    Effect.flatMap((provided) =>
      Option.isSome(provided)
        ? Effect.provideService(effect, JobOperationsService, provided.value)
        : Effect.sync(() => loadRepoEnv()).pipe(
            Effect.zipRight(
              effect.pipe(
                Effect.provide(jobsLayer),
                Effect.withConfigProvider(ConfigProvider.fromEnv())
              )
            )
          )
    )
  );

/**
 * Queue the voice of every Clip Mockup named, as one Job, and nudge the
 * Sidecar so it starts now. Nothing to voice queues nothing. A Sidecar that
 * is down finds the Job when it starts.
 */
export const queueClipMockupVoices = (
  rows: ReadonlyArray<{ readonly id: string; readonly videoId: string }>
) =>
  rows.length === 0
    ? Effect.succeed(null)
    : withJobOperations(
        Effect.gen(function* () {
          const videoIds = new Set(rows.map((r) => r.videoId));
          const job = yield* enqueueJob({
            id: null,
            kind: CLIP_MOCKUP_VOICE_JOB_KIND,
            title:
              rows.length === 1
                ? "Voice 1 Clip Mockup"
                : `Voice ${rows.length} Clip Mockups`,
            params: { clipMockupIds: rows.map((r) => r.id) },
            dependsOn: null,
            subject:
              videoIds.size === 1
                ? { type: "video", id: rows[0]!.videoId }
                : null,
            attemptsSpent: 0,
            registry: JOB_KIND_SPECS,
          });
          // Best effort, and silent: STDERR is the CLI's error contract.
          yield* nudgeSidecar().pipe(Logger.withMinimumLogLevel(LogLevel.None));
          return job;
        })
      );

/**
 * A Clip Mockup row as `cvm clip-mockup` prints it. A voice that is not
 * `ready` has no measured length yet, so `durationSeconds` is the guess from
 * its words and `durationEstimated` is true: summing `durationSeconds` over a
 * Video still gives its run time, and says how much of it is a guess.
 */
export const withVoiceDuration = <
  Row extends {
    readonly line: string;
    readonly durationSeconds: number | null;
    readonly voiceStatus: string;
  },
>(
  row: Row
): Omit<Row, "durationSeconds"> & {
  readonly durationSeconds: number;
  readonly durationEstimated: boolean;
} =>
  row.voiceStatus === "ready" && row.durationSeconds !== null
    ? { ...row, durationSeconds: row.durationSeconds, durationEstimated: false }
    : {
        ...row,
        durationSeconds: estimateSpokenSeconds(row.line),
        durationEstimated: true,
      };
