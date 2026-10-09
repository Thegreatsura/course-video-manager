import { Cause, Config, Deferred, Effect, Exit, Schedule } from "effect";
import { SidecarContext } from "./sidecar-context";
import { makeCoursePublishReads } from "./course-publish-reads";
import { dropboxAppCredentials } from "./dropbox-auth-service";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoExportService } from "./video-export-service";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import { OverlayRenderCacheService } from "./overlay-render-cache.server";
import { garbageCollect } from "./export-hash.server";
import {
  exportVideoToItsAddress,
  type ExportStage,
} from "./course-publish-export-video";
import { type PlaceholderFloor } from "@/packages/course-json";
import { findShippingVideos as findShippingVideosCore } from "./course-publish-video-roster";
import {
  ExportError,
  PublishCommitFailedError,
  PublishValidationError,
} from "./course-publish-errors";
import { syncFrozenCourseVersionToDropbox } from "./course-publish-dropbox";
import {
  runObservedExportLoop,
  type EmitPublishDetailEvent,
  type PublishStage,
} from "./course-publish-export-events";

export type { VideoForExport } from "./course-publish-reads";

export type PublishOptions = {
  courseId: string;
  versionName: string;
  versionDescription: string;
  includeTodoLessons: boolean;
  // The lowest Lesson Priority band whose unshippable Lessons are announced as
  // Placeholder Lessons. REQUIRED: `ANNOUNCE_NOTHING` is the announce-nothing
  // position, a real answer rather than an absent one, and each caller
  // normalises its own boundary to it (both the CLI flag and the SSE body
  // default to the `none` band).
  placeholderFloor: PlaceholderFloor;
  // The coarse publish lifecycle stage (validating → … → complete).
  onStageChange?: (stage: PublishStage) => void;
  // Per-video export events (same names/payloads as batchExport: `videos`,
  // `stage`, `complete`, `error` keyed by videoId) plus the Dropbox commit's
  // `progress` percentage — pure observability.
  onDetailEvent?: EmitPublishDetailEvent;
};

export class CoursePublishService extends Effect.Service<CoursePublishService>()(
  "CoursePublishService",
  {
    effect: Effect.gen(function* () {
      const versionOps = yield* VersionOperationsService;
      // The read side — where an export lives, whether it is there, and the
      // publish gate — is the app server's too (`CoursePublishReadService`);
      // this service adds the work only the Sidecar may run.
      const reads = yield* makeCoursePublishReads;
      const { validatePublishability } = reads;
      const FINISHED_VIDEOS_DIRECTORY = yield* Config.string(
        "FINISHED_VIDEOS_DIRECTORY"
      );

      // The export step itself lives in ./course-publish-export-video so it
      // can be read — and grown — on its own. Its deps are closed over here so
      // callers of this service don't inherit them.
      const exportContext = yield* Effect.context<
        | VideoOperationsService
        | VideoExportService
        | VideoEditorLoggerService
        | OverlayRenderCacheService
        | FileSystem.FileSystem
      >();
      const exportVideoCore = Effect.fn("exportVideoCore")(function* (
        videoId: string,
        onStage?: (stage: ExportStage) => void,
        onProgress?: (info: { stage: ExportStage; percent: number }) => void
      ) {
        return yield* exportVideoToItsAddress({
          videoId,
          finishedVideosDirectory: FINISHED_VIDEOS_DIRECTORY,
          onStage,
          onProgress,
        }).pipe(Effect.provide(exportContext));
      });

      const exportVideo = Effect.fn("exportVideo")(function* (
        videoId: string,
        onStage?: (stage: "concatenating-clips" | "normalizing-audio") => void,
        onProgress?: (info: {
          stage: "concatenating-clips" | "normalizing-audio";
          percent: number;
        }) => void
      ) {
        // An export is a Job: only the Sidecar runs it (sidecar-context.ts).
        yield* SidecarContext;
        const { targetPath, owner } = yield* exportVideoCore(
          videoId,
          onStage,
          onProgress
        );
        if (owner.kind === "course") {
          yield* garbageCollect(owner.courseId);
        }
        return targetPath;
      });

      // The publish/export roster walk lives in ./course-publish-video-roster
      // so it can be read on its own. Its deps are closed over here so callers
      // of this service don't inherit them.
      const rosterContext = yield* Effect.context<
        VersionOperationsService | FileSystem.FileSystem
      >();
      const findShippingVideos = Effect.fn("findShippingVideos")(function* (
        versionId: string,
        includeTodoLessons: boolean
      ) {
        return yield* findShippingVideosCore(
          versionId,
          includeTodoLessons
        ).pipe(Effect.provide(rosterContext));
      });

      const batchExport = Effect.fn("batchExport")(function* (
        versionId: string,
        includeTodoLessons: boolean,
        onDetailEvent?: EmitPublishDetailEvent,
        /**
         * Videos this batch must leave alone: a re-run of a Batch export Job
         * skips the ones it already handed on as their own export Jobs.
         */
        skipVideoIds: ReadonlySet<string> = new Set()
      ) {
        // A Batch export is a Job: only the Sidecar runs it, never a request
        // a browser tab keeps alive (sidecar-context.ts).
        yield* SidecarContext;
        const shipping = yield* findShippingVideos(
          versionId,
          includeTodoLessons
        );
        const courseId = shipping.courseId;
        const unexportedVideos = shipping.unexportedVideos.filter(
          (video) => !skipVideoIds.has(video.id)
        );

        yield* runObservedExportLoop({
          unexportedVideos,
          exportVideo: exportVideoCore,
          onDetailEvent,
        });

        if (unexportedVideos.length === 0) return;

        // GC once after all exports
        yield* garbageCollect(courseId);
      });

      const publishUnlocked = Effect.fn("publishUnlocked")(function* (
        options: PublishOptions
      ) {
        const {
          courseId,
          versionName,
          versionDescription,
          includeTodoLessons,
          placeholderFloor,
          onStageChange,
          onDetailEvent,
        } = options;
        onStageChange?.("validating");

        // Before the Submit, before any encoding — see `dropboxAppCredentials`.
        yield* dropboxAppCredentials;

        const latestVersion =
          yield* versionOps.getLatestCourseVersion(courseId);
        if (!latestVersion) {
          return yield* Effect.die(new Error("No version found for course"));
        }

        // The floor reaches the gate only so the counts it reports describe THIS
        // release: no gate reads the floor (see course-publish-readiness), so it
        // cannot change whether a publish is refused.
        const validation = yield* validatePublishability(
          latestVersion.id,
          placeholderFloor
        );
        const position = includeTodoLessons
          ? validation.withTodo
          : validation.withoutTodo;
        const { courseViewLintCount } = position;
        if (courseViewLintCount > 0) {
          return yield* new PublishValidationError({
            courseViewLintCount,
          });
        }

        // Submit FIRST. It is a pure database transaction with no dependency
        // on exports whatsoever, and it is what makes everything after it
        // sound: a Draft Version legally accepts Clip, Video and Section
        // writes, and a Video's title is its path inside the Dropbox bundle —
        // so encoding or uploading from a Draft lets an edit landing mid-flight
        // invalidate work already done.
        onStageChange?.("freezing");
        onStageChange?.("cloning");
        const { version: newDraft } = yield* versionOps
          .freezeAndCloneVersion({
            sourceVersionId: latestVersion.id,
            repoId: courseId,
            newVersionName: "",
            sourceName: versionName,
            sourceDescription: versionDescription,
          })
          .pipe(
            // A name another Version already wears (a second Publish of the
            // same name queued before the first ran) is bad input, not a
            // fault: the same validation error, so exit 3 and the same toast.
            Effect.catchTag("VersionNameTakenError", (cause) =>
              Effect.fail(
                new PublishValidationError({ versionNameTaken: cause.name })
              )
            )
          );

        // Re-walk with titles so both halves are observable per Video — the
        // export step emits the same events the standalone batchExport does,
        // and the upload phase draws its task roster from the same walk. The
        // Export Hash is untouched by Submit: the clone copies Clip
        // filenames, source timings and order verbatim and never mutates the
        // source rows, so this walk sees exactly what validation saw.
        //
        // Every Unexported Video this walk finds is exported. No encode is
        // ever cancelled on the strength of a copy that has not happened yet:
        // what Dropbox receives is decided by each Video's BYTES, and this
        // machine has no bytes to compare until the encode has produced them.
        // The saving survives because the encode is reproducible — a Video
        // whose bytes Dropbox already holds is still copied rather than
        // uploaded — so reuse now costs GPU time instead of a wrong Bundle
        // (issue #1562).
        const { unexportedVideos, shippingVideos } = yield* findShippingVideos(
          latestVersion.id,
          includeTodoLessons
        );

        // Announce the whole roster before either pool starts, so every Video
        // has a task from the outset rather than appearing when its bytes
        // happen to move.
        onDetailEvent?.({
          event: "upload-videos",
          data: { videos: shippingVideos },
        });

        // THE HANDOFF QUEUE between two pools that must not share a budget:
        // the export pool (GPU-bound, six-way concurrent) and the upload pool
        // (network-bound, its own smaller limit). One latch per Video still to
        // encode; a Video already exported has none and is ready immediately.
        // The upload pool waits on a single Video's latch rather than on the
        // export phase as a whole, which is what makes the two overlap.
        const exportLatches = new Map<
          string,
          Deferred.Deferred<void, ExportError>
        >();
        for (const video of unexportedVideos) {
          exportLatches.set(
            video.id,
            yield* Deferred.make<void, ExportError>()
          );
        }
        const awaitVideoReady = (videoId: string) => {
          const latch = exportLatches.get(videoId);
          return latch ? Deferred.await(latch) : Effect.void;
        };

        // A Video with no latch already has its bytes on disk: it is waiting
        // for a slot in the upload pool from the very first moment, never
        // encoding.
        for (const video of shippingVideos) {
          if (exportLatches.has(video.id)) continue;
          onDetailEvent?.({
            event: "upload-queued",
            data: { videoId: video.id },
          });
        }

        if (unexportedVideos.length > 0) onStageChange?.("exporting");
        onStageChange?.("uploading");

        const exportPhase = Effect.gen(function* () {
          if (unexportedVideos.length === 0) {
            return { failedVideoIds: [] as string[] };
          }
          return yield* runObservedExportLoop({
            unexportedVideos,
            exportVideo: exportVideoCore,
            onDetailEvent,
            onVideoSettled: ({ videoId, exported }) => {
              const latch = exportLatches.get(videoId)!;
              if (exported) {
                // Out of the export pool, into the upload queue — the one
                // moment a Video is genuinely waiting rather than working.
                onDetailEvent?.({
                  event: "upload-queued",
                  data: { videoId },
                });
              }
              return exported
                ? Deferred.succeed(latch, undefined)
                : Deferred.fail(
                    latch,
                    new ExportError({
                      message: `Export failed for video ${videoId}`,
                      cause: null,
                    })
                  );
            },
          });
        }).pipe(
          // Never strand the upload pool waiting on a latch the export pool
          // will now never settle. Completing an already-settled latch is a
          // no-op, so this only catches the abnormal exits.
          Effect.ensuring(
            Effect.forEach(
              exportLatches.values(),
              (latch) =>
                Deferred.fail(
                  latch,
                  new ExportError({
                    message: "Export did not complete",
                    cause: null,
                  })
                ),
              { discard: true }
            )
          )
        );

        // Commit: the Dropbox commit, culminating in the atomic `course.json`
        // rename — the external commit receipt. A caught failure is TERMINAL
        // for this Pending Version (issue #1401): retry the Commit once
        // in-flight (`sync_failed` only), then auto-Discard. The sync is
        // content-addressed and idempotent, so a later re-publish re-uploads
        // nothing that already landed.
        const commitPhase = Effect.exit(
          syncFrozenCourseVersionToDropbox({
            courseId,
            courseVersionId: latestVersion.id,
            includeTodoLessons,
            placeholderFloor,
            onDetailEvent,
            awaitVideoReady,
          }).pipe(Effect.retry(Schedule.recurs(1)))
        );

        // Both pools run to completion. Neither can fail outright — the export
        // loop collects its failures, the commit is captured as an Exit — so
        // neither ever interrupts the other mid-encode or mid-transfer.
        const [exportResult, commitExit] = yield* Effect.all(
          [exportPhase, commitPhase],
          { concurrency: 2 }
        );

        if (exportResult.failedVideoIds.length > 0) {
          // A Pending Version now exists by the time export can fail, so
          // Discard it rather than stranding it for manual reconciliation.
          // The error the caller sees is unchanged: the failed Video ids —
          // reported ahead of whatever the commit made of the failure.
          yield* versionOps.discardPendingVersion(latestVersion.id);
          return yield* new PublishValidationError({
            failedExportVideoIds: exportResult.failedVideoIds,
          });
        }
        if (Exit.isFailure(commitExit)) {
          yield* versionOps.discardPendingVersion(latestVersion.id);
          return yield* new PublishCommitFailedError({
            discardedVersionId: latestVersion.id,
            newDraftVersionId: newDraft.id,
            reason: "sync_failed",
            // `sync_failed` names no cause; the Exit is the only place one is.
            message: Cause.pretty(commitExit.cause),
          });
        }
        if (commitExit.value.missingVideos.length > 0) {
          // Missing assets are deterministic — retrying cannot conjure the
          // files — so Discard immediately, naming the missing Videos.
          yield* versionOps.discardPendingVersion(latestVersion.id);
          return yield* new PublishCommitFailedError({
            discardedVersionId: latestVersion.id,
            newDraftVersionId: newDraft.id,
            reason: "missing_assets",
            missingVideoIds: commitExit.value.missingVideos.map(
              (video) => video.videoId
            ),
          });
        }

        // Promote: the receipt landed, so the Pending Version is Published.
        yield* versionOps.promotePendingVersion(latestVersion.id);

        // Reclaim stale exports LAST, once every byte has gone past and the
        // Version is Published. GC deletes any Exported Video whose Export
        // Hash is unreachable from current database state and cannot tell a
        // file being streamed to Dropbox from an abandoned one — so it must
        // never run while uploads are in flight. Nothing depends on it, so
        // its failure is logged, never the Publish's: failing here would
        // leave a published release reported as failed.
        if (unexportedVideos.length > 0) {
          yield* garbageCollect(courseId).pipe(
            Effect.catchAllCause((cause) =>
              Effect.logWarning(
                "publish: garbage collection failed",
                Cause.pretty(cause)
              )
            )
          );
        }

        onStageChange?.("complete");

        return {
          publishedVersionId: latestVersion.id,
          newDraftVersionId: newDraft.id,
          // What this release did with every Lesson, counted: a headless run
          // sees no publish page, so this is its only report of what the floor
          // announced and what it left behind.
          lessonCounts: {
            ships: position.ships,
            placeholders: position.placeholderLessons.length,
            withheld: position.withheldLessons.length,
          },
        };
      });

      // A Publish is a Job: only the Sidecar runs it (sidecar-context.ts).
      // Its `publish` lane runs one at a time, which is what keeps two from
      // interleaving around the database freeze and the Dropbox commit
      // marker — the semaphore this service held is gone with the
      // in-process callers.
      const publish = Effect.fn("publish")(function* (options: PublishOptions) {
        yield* SidecarContext;
        return yield* publishUnlocked(options);
      });

      return {
        ...reads,
        exportVideo,
        batchExport,
        publish,
      };
    }),
  }
) {}
