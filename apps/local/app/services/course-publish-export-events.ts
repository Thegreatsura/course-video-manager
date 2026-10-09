import { Data, Effect, Schedule } from "effect";

// One Video's encode, stage by stage. `queued` is a position in the pool
// rather than work, so only the two working stages carry a percentage.
export type ExportStage =
  "queued" | "concatenating-clips" | "normalizing-audio";
export type ExportWorkingStage = Exclude<ExportStage, "queued">;

// The observable surface of a publish/batch-export run. Every emission is a
// member of this union, so a typo'd event name or a malformed payload fails
// typecheck instead of silently dropping on the SSE floor.
export type PublishDetailEvent =
  // The full list of Videos this run will export, titled section/lesson/title.
  | { event: "videos"; data: { videos: Array<{ id: string; title: string }> } }
  | {
      event: "stage";
      data: {
        videoId: string;
        stage: ExportStage;
      };
    }
  | { event: "complete"; data: { videoId: string } }
  | { event: "error"; data: { videoId: string; message: string } }
  // Real ffmpeg progress within an export stage: integer percent 0–99 that
  // resets when the stage changes (100 is signalled by `complete`).
  | {
      event: "video-progress";
      data: {
        videoId: string;
        stage: ExportWorkingStage;
        percent: number;
      };
    }
  // Per-lesson upload percentage from the Dropbox commit.
  | { event: "progress"; data: { percentage: number } }
  // ── The Dropbox upload, one task per shipping Video ──────────────────────
  // Every Video this Publish ships, titled section/lesson/title. Unlike the
  // export `videos` roster above this is the WHOLE bundle: a Video a previous
  // run already exported does no encoding but still has to be uploaded, so it
  // still gets a task.
  | {
      event: "upload-videos";
      data: { videos: Array<{ id: string; title: string }> };
    }
  // This Video's bytes exist — its export settled, or it was already on disk —
  // and it is now waiting for a slot in the upload pool.
  | { event: "upload-queued"; data: { videoId: string } }
  // Bytes moving for one Video. Emitted at 0 the moment the upload pool picks
  // the Video up, so `totalBytes` (its size on disk) is known from the start
  // and a consumer can weight this Video against its siblings.
  | {
      event: "upload-video-progress";
      data: { videoId: string; uploadedBytes: number; totalBytes: number };
    }
  | { event: "upload-video-complete"; data: { videoId: string; bytes: number } }
  | { event: "upload-video-error"; data: { videoId: string; message: string } }
  // ── Reuse from the previously Published Bundle ───────────────────────────
  // There is no upfront announcement of the reusable set. Which Videos Dropbox
  // can copy from its own storage is decided by their BYTES, and a Video's
  // bytes are not known until its own export has landed, so the set only
  // exists one Video at a time (issue #1562).
  //
  // One Video's copy has landed and its content hash matched its source. A
  // Video that fails to copy never reaches here — it emits an ordinary upload
  // task instead, because it has rejoined the upload queue.
  | { event: "upload-video-reused"; data: { videoId: string; bytes: number } };

export type EmitPublishDetailEvent = (e: PublishDetailEvent) => void;

// The coarse publish lifecycle stages, in emission order.
export type PublishStage =
  | "validating"
  | "exporting"
  | "uploading"
  | "freezing"
  | "cloning"
  | "complete";

// Videos in flight at once, not encodes: however many Videos are in flight,
// across every Job in the Sidecar, only `FfmpegPermitsService`'s encode slots
// (default 2) run ffmpeg at a time — `runFfmpegWithProgress` takes one per
// pass. The rest wait their turn, and their Job's log says so.
export const MAX_CONCURRENT_EXPORTS = 6;

export const extractErrorMessage = (e: unknown, fallback: string): string =>
  typeof e === "object" &&
  e !== null &&
  "message" in e &&
  typeof e.message === "string"
    ? e.message
    : fallback;

// The shared per-video export+emission loop behind both batchExport and
// publish: emit the `videos` list, pre-emit `queued` per Video, run the
// export with its ffmpeg stage wiring, retry twice per Video, emit
// `complete`/`error` per Video, and return the ids that still failed.
//
// The queue runs in the order it is handed over — announced, queued, and
// started front to back — so the caller that builds the list decides which
// Videos begin first.
//
// `onVideoSettled` is the HANDOFF out of the export pool: it fires once a
// Video's export has finally succeeded or failed, and is what lets a
// downstream pool (the Dropbox upload pool) start on that one Video while its
// siblings are still encoding. It runs inside the fan-out, so it is reached as
// soon as that Video settles rather than when the loop as a whole finishes.
//
// `afterAFailure` says what a Video that fails does to its siblings. A Batch
// export's Videos stand alone, so it `"keep-going"`s, retrying each Video
// twice. A Publish ships every Video or none, so one that will not export
// dooms the run: it `"stop"`s on the first failure, without a retry,
// interrupting the encodes still running (their ffmpeg children die with
// their scopes) and never starting the queued ones. Before this, a failed
// Publish sat on for as long as the retries and every other Video took to
// encode (Publish Job 859b8689: twelve minutes, until the sidecar stopped).
export const runObservedExportLoop = <A, E, R>(input: {
  unexportedVideos: Array<{ id: string; title: string }>;
  exportVideo: (
    videoId: string,
    onStage: (stage: ExportWorkingStage) => void,
    onProgress: (info: { stage: ExportWorkingStage; percent: number }) => void
  ) => Effect.Effect<A, E, R>;
  onDetailEvent?: EmitPublishDetailEvent;
  onVideoSettled?: (result: {
    videoId: string;
    exported: boolean;
  }) => Effect.Effect<void>;
  afterAFailure: "keep-going" | "stop";
}): Effect.Effect<ObservedExportResult, never, R> =>
  Effect.gen(function* () {
    const { unexportedVideos, exportVideo, onDetailEvent, onVideoSettled } =
      input;

    onDetailEvent?.({
      event: "videos",
      data: {
        videos: unexportedVideos.map((v) => ({ id: v.id, title: v.title })),
      },
    });

    for (const video of unexportedVideos) {
      onDetailEvent?.({
        event: "stage",
        data: { videoId: video.id, stage: "queued" },
      });
    }

    // Suspended so the hand-off is only reached when the Video actually
    // settles, never while the fan-out is being described.
    const settle = (videoId: string, exported: boolean) =>
      Effect.suspend(
        () => onVideoSettled?.({ videoId, exported }) ?? Effect.void
      );

    const failures: ExportFailure[] = [];
    yield* Effect.forEach(
      unexportedVideos,
      (video) =>
        exportVideo(
          video.id,
          (stage) => {
            onDetailEvent?.({
              event: "stage",
              data: { videoId: video.id, stage },
            });
          },
          ({ stage, percent }) => {
            onDetailEvent?.({
              event: "video-progress",
              data: { videoId: video.id, stage, percent },
            });
          }
        ).pipe(
          // A Batch export retries a Video twice. A Publish does not: its
          // first failed Video already dooms the run, and a re-run of the
          // Publish skips every Video that did land at its address.
          Effect.retry(Schedule.recurs(input.afterAFailure === "stop" ? 0 : 2)),
          Effect.tap(() => {
            onDetailEvent?.({
              event: "complete",
              data: { videoId: video.id },
            });
          }),
          Effect.matchEffect({
            onSuccess: () => settle(video.id, true),
            onFailure: (e) =>
              Effect.sync(() => {
                const message = extractErrorMessage(
                  e,
                  "Export failed unexpectedly"
                );
                onDetailEvent?.({
                  event: "error",
                  data: { videoId: video.id, message },
                });
                failures.push({ videoId: video.id, message });
              }).pipe(Effect.andThen(settle(video.id, false))),
          }),
          // Outside the match, so it fails the fan-out rather than being
          // matched away: Effect.forEach then interrupts every sibling.
          Effect.andThen(() =>
            input.afterAFailure === "stop" &&
            failures.some((f) => f.videoId === video.id)
              ? Effect.fail(new ExportLoopStopped())
              : Effect.void
          )
        ),
      { concurrency: MAX_CONCURRENT_EXPORTS }
    ).pipe(Effect.catchTag("ExportLoopStopped", () => Effect.void));

    return {
      failedVideoIds: failures.map((f) => f.videoId),
      failures,
    };
  });

export type ExportFailure = { videoId: string; message: string };

export type ObservedExportResult = {
  failedVideoIds: string[];
  /** Why each failed Video failed, in the order they failed. */
  failures: ExportFailure[];
};

/** Private signal: a `"stop"` loop has seen its first failed Video. */
class ExportLoopStopped extends Data.TaggedError("ExportLoopStopped") {}
