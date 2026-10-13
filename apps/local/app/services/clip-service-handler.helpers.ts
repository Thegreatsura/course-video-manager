/**
 * Helper functions and types for ClipService handler.
 */

import { clips, chapters, videos } from "@/db/schema";
import { compareOrderStrings } from "@/lib/sort-by-order";
import { and, asc, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import type {
  ClipServiceEvent,
  CreateVideoFromSelectionInput,
} from "./clip-service";
import type { Database } from "@/services/drizzle-service.server";
import { UnknownDBServiceError } from "@/services/db-service-errors";
import { requireDraftVersionForVideo } from "@/services/draft-guard.server";
import { withDbTransaction } from "@/services/with-db-transaction.server";
import { createVideoFromSelectionImpl } from "@/services/db-video-from-selection.server";
import type { LogEvent } from "./video-editor-logger-service";
import type { SilenceLength } from "@/silence-detection-constants";
import { toRootRelative } from "@/packages/storage";
import { storageRootsConfig } from "@/services/storage-roots";

// ============================================================================
// Errors and the Drizzle bridge
// ============================================================================

/** A Drizzle call whose rejection lands in E, not as a defect. */
export const dbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

/** The OBS clip detection behind append-from-obs rejected. */
export class ObsClipDetectionError extends Data.TaggedError(
  "ObsClipDetectionError"
)<{ cause: unknown }> {}

// ============================================================================
// Types
// ============================================================================

/**
 * Adapter for VideoProcessingService functionality.
 * In production, this wraps the Effect-based service.
 * In tests, this is mocked.
 */
export interface VideoProcessingAdapter {
  getLatestOBSVideoClips: (opts: {
    filePath: string | undefined;
    startTime: number | undefined;
    silenceLength?: SilenceLength;
    thresholdDb?: number;
  }) => Promise<{
    readonly clips: ReadonlyArray<{
      readonly inputVideo: string;
      readonly startTime: number;
      readonly endTime: number;
    }>;
  }>;
}

/**
 * Adapter for VideoEditorLoggerService.
 * In production, wraps the Effect-based logger service.
 * In tests, can be a no-op.
 */
export interface LoggerAdapter {
  log: (videoId: string, event: LogEvent) => void;
}

export const noopLogger: LoggerAdapter = { log: () => {} };

// ============================================================================
// Helper: Windows to WSL path conversion
// ============================================================================

export function windowsToWSL(windowsPath: string): string {
  // Convert C:\Users\... to /mnt/c/Users/...
  const drive = windowsPath.charAt(0).toLowerCase();
  const pathWithoutDrive = windowsPath.slice(3); // Remove "C:\"

  // Convert backslashes to forward slashes
  const unixPath = pathWithoutDrive.replace(/\\/g, "/");

  return `/mnt/${drive}/${unixPath}`;
}

// ============================================================================
// Helper: Get all items for a video sorted by order
// ============================================================================

export const getOrderedItems = Effect.fn("getOrderedItems")(function* (
  db: Database,
  videoId: string
) {
  const allClips = yield* dbCall(() =>
    db.query.clips.findMany({
      where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
      orderBy: asc(clips.order),
    })
  );

  const allChapters = yield* dbCall(() =>
    db.query.chapters.findMany({
      where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
      orderBy: asc(chapters.order),
    })
  );

  const allItems = [
    ...allClips.map((c) => ({ type: "clip" as const, ...c })),
    ...allChapters.map((cs) => ({
      type: "chapter" as const,
      ...cs,
    })),
  ].sort((a, b) => compareOrderStrings(a.order, b.order));

  return allItems;
});

// ============================================================================
// Helper: Touch video updatedAt timestamp
// ============================================================================

export const touchVideoUpdatedAt = (db: Database, videoId: string) =>
  dbCall(() =>
    db
      .update(videos)
      .set({ updatedAt: new Date() })
      .where(eq(videos.id, videoId))
  );

// ============================================================================
// Helper: Where a saved Clip goes
// ============================================================================

/**
 * The orders a Clip saved at `insertionPoint` goes between. A save never
 * fails because of its insertion point (#2163): one naming an archived item
 * (deleted from the Stream Deck while a take was saving) places it where
 * that item stood, so restoring the item puts it back before it; one naming
 * an item that is gone places it at the end.
 */
const ordersAroundInsertionPoint = Effect.fn("ordersAroundInsertionPoint")(
  function* (
    db: Database,
    videoId: string,
    allItems: ReadonlyArray<{
      type: "clip" | "chapter";
      id: string;
      order: string;
    }>,
    insertionPoint: Extract<
      ClipServiceEvent,
      { type: "append-clips" }
    >["input"]["insertionPoint"]
  ) {
    if (insertionPoint.type === "start")
      return { prevOrder: null, nextOrder: allItems[0]?.order ?? null };

    const type = insertionPoint.type === "after-clip" ? "clip" : "chapter";
    const id =
      insertionPoint.type === "after-clip"
        ? insertionPoint.databaseClipId
        : insertionPoint.chapterId;
    const index = allItems.findIndex((i) => i.type === type && i.id === id);
    if (index !== -1)
      return {
        prevOrder: allItems[index]!.order,
        nextOrder: allItems[index + 1]?.order ?? null,
      };

    const table = type === "clip" ? clips : chapters;
    const archived = yield* dbCall(() =>
      db
        .select({ order: table.order })
        .from(table)
        .where(and(eq(table.id, id), eq(table.videoId, videoId)))
        .limit(1)
    );
    const order = archived[0]?.order;
    if (order === undefined)
      return { prevOrder: allItems.at(-1)?.order ?? null, nextOrder: null };
    return {
      prevOrder: order,
      nextOrder:
        allItems.find((i) => compareOrderStrings(i.order, order) > 0)?.order ??
        null,
    };
  }
);

// ============================================================================
// Helper: Append clips at an insertion point
// ============================================================================

export const appendClipsAtInsertionPoint = Effect.fn(
  "appendClipsAtInsertionPoint"
)(function* (
  db: Database,
  input: Extract<ClipServiceEvent, { type: "append-clips" }>["input"]
) {
  const { videoId, insertionPoint, clips: inputClips } = input;
  const allItems = yield* getOrderedItems(db, videoId);

  const { prevOrder, nextOrder } = yield* ordersAroundInsertionPoint(
    db,
    videoId,
    allItems,
    insertionPoint
  );

  const orders = generateNKeysBetween(prevOrder, nextOrder, inputClips.length);

  const insertValues = inputClips.map((clip, index) => ({
    videoId,
    videoFilename: clip.inputVideo,
    sourceStartTime: clip.startTime,
    sourceEndTime: clip.endTime,
    order: orders[index]!,
    archived: false,
    text: "",
    // A fresh recording has no text until its Transcription lands.
    transcriptionStatus: "queued" as const,
    recordingSessionId: clip.recordingSessionId ?? null,
    scene: clip.scene ?? null,
  }));

  const clipsResult = yield* dbCall(() =>
    db.insert(clips).values(insertValues).returning()
  );

  return clipsResult;
});

// ============================================================================
// Helper: Place Clips — the placement half every recorder shares
// ============================================================================

/**
 * Save Clips at an insertion point, in one transaction that re-checks the
 * Draft under the version-row lock (#1403), so a Clip can never land on a
 * version that stopped being a Draft while its speech was being found. The
 * caller holds the video's mutex (`withVideoMutex`).
 */
export const placeClips = (
  db: Database,
  input: Extract<ClipServiceEvent, { type: "append-clips" }>["input"]
) =>
  withDbTransaction(db, (tx) =>
    Effect.gen(function* () {
      yield* requireDraftVersionForVideo(tx, input.videoId);
      const inserted = yield* appendClipsAtInsertionPoint(tx, input);
      yield* touchVideoUpdatedAt(tx, input.videoId);
      return inserted;
    })
  );

// ============================================================================
// Mutex: Serialize Clip placement per videoId (append-from-obs, speech)
// ============================================================================

interface VideoMutex {
  readonly semaphore: Effect.Semaphore;
  users: number;
}

const videoMutexes = new Map<string, VideoMutex>();

/**
 * Runs `effect` holding the per-video permit, so concurrent append-from-obs
 * calls for one video run one at a time. The entry is dropped once the last
 * waiter is done, so the map never grows with every video ever touched.
 */
export const withVideoMutex = <A, E, R>(
  videoId: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    let mutex = videoMutexes.get(videoId);
    if (!mutex) {
      mutex = { semaphore: Effect.unsafeMakeSemaphore(1), users: 0 };
      videoMutexes.set(videoId, mutex);
    }
    const held = mutex;
    held.users++;
    return held.semaphore
      .withPermits(1)(effect)
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            held.users--;
            if (held.users === 0 && videoMutexes.get(videoId) === held) {
              videoMutexes.delete(videoId);
            }
          })
        )
      );
  });

// ============================================================================
// Helper: append-from-obs implementation (runs inside mutex)
// ============================================================================

export const appendFromObsImpl = (
  db: Database,
  event: Extract<ClipServiceEvent, { type: "append-from-obs" }>,
  videoProcessing: VideoProcessingAdapter,
  logger: LoggerAdapter
) =>
  Effect.gen(function* () {
    const { videoId, filePath, insertionPoint } = event.input;
    // A Footage path is stored absolute (`/mnt/d/raw-footage/x.mkv`, what OBS
    // reports) or root-relative (`raw-footage/x.mkv`, after the path
    // migration). Both name one file, so compare them in one form: a take
    // clipped before and after the migration must not be appended twice.
    const storageRoots = yield* storageRootsConfig;
    const sameFootage = (a: string, b: string | undefined) =>
      b !== undefined &&
      toRootRelative(a, storageRoots) === toRootRelative(b, storageRoots);

    // Convert Windows path to WSL path if provided
    const resolvedFilePath = filePath ? windowsToWSL(filePath) : undefined;

    // Get all clips (including archived) to find the last clip with this input video
    const allClipsIncludingArchived = yield* dbCall(() =>
      db.query.clips.findMany({
        where: eq(clips.videoId, videoId),
      })
    );

    // Find clips with this input video and get the one with the latest end time
    const clipsWithThisInputVideo = allClipsIncludingArchived
      .filter((clip) => sameFootage(clip.videoFilename, resolvedFilePath))
      .sort((a, b) => b.sourceStartTime - a.sourceStartTime);

    const lastClipWithThisInputVideo = clipsWithThisInputVideo[0];

    // Calculate start time: end time of last clip - 1 second for silence gap
    const resolvedStartTime =
      typeof lastClipWithThisInputVideo?.sourceEndTime === "number"
        ? Math.max(lastClipWithThisInputVideo.sourceEndTime - 1, 0)
        : undefined;

    // Call CLI to detect clips
    const latestOBSVideoClips = yield* Effect.tryPromise({
      try: () =>
        videoProcessing.getLatestOBSVideoClips({
          filePath: resolvedFilePath,
          startTime: resolvedStartTime,
          silenceLength: event.input.silenceLength,
          thresholdDb: event.input.silenceThresholdDb,
        }),
      catch: (cause) => new ObsClipDetectionError({ cause }),
    });

    if (latestOBSVideoClips.clips.length === 0) {
      logger.log(videoId, {
        type: "clips-appended-from-obs",
        videoId,
        detected: 0,
        duplicatesSkipped: 0,
        inserted: 0,
        clips: [],
      });
      return [];
    }

    // Re-fetch clips for deduplication (in case they changed during CLI detection)
    const allClipsForDedup = yield* dbCall(() =>
      db.query.clips.findMany({
        where: eq(clips.videoId, videoId),
      })
    );

    // Filter out clips that already exist (deduplicate by videoFilename + startTime + endTime)
    // Uses a tolerance of 0.6s to account for ffmpeg silence detection variance across runs.
    // Silence detection start times can drift by 0.24-0.57s depending on keyframe alignment.
    // 0.6s is safe because minimum clip length is 1s, so distinct clips can't match.
    const DEDUP_TOLERANCE_SECONDS = 0.6;
    const clipsToAdd = latestOBSVideoClips.clips.filter(
      (clip) =>
        !allClipsForDedup.some(
          (existingClip) =>
            sameFootage(existingClip.videoFilename, clip.inputVideo) &&
            Math.abs(existingClip.sourceStartTime - clip.startTime) <
              DEDUP_TOLERANCE_SECONDS &&
            Math.abs(existingClip.sourceEndTime - clip.endTime) <
              DEDUP_TOLERANCE_SECONDS
        )
    );

    if (clipsToAdd.length === 0) {
      logger.log(videoId, {
        type: "clips-appended-from-obs",
        videoId,
        detected: latestOBSVideoClips.clips.length,
        duplicatesSkipped: latestOBSVideoClips.clips.length,
        inserted: 0,
        clips: [],
      });
      return [];
    }

    // #1403: the Draft may have been Submitted while OBS detection ran above;
    // placeClips re-checks under the version-row lock.
    const result = yield* placeClips(db, {
      videoId,
      insertionPoint,
      clips: clipsToAdd,
    });

    const totalDuplicatesSkipped =
      latestOBSVideoClips.clips.length - result.length;

    logger.log(videoId, {
      type: "clips-appended-from-obs",
      videoId,
      detected: latestOBSVideoClips.clips.length,
      duplicatesSkipped: totalDuplicatesSkipped,
      inserted: result.length,
      clips: result.map((c) => ({
        inputVideo: c.videoFilename,
        startTime: c.sourceStartTime,
        endTime: c.sourceEndTime,
      })),
    });

    return result;
  });

// ============================================================================
// Handler: create-effect-clip-at-position
// ============================================================================

export const createEffectClipAtPositionImpl = Effect.fn(
  "createEffectClipAtPositionImpl"
)(function* (
  db: Database,
  input: Extract<
    ClipServiceEvent,
    { type: "create-effect-clip-at-position" }
  >["input"],
  logger: LoggerAdapter
) {
  const {
    videoId,
    position,
    targetItemId,
    targetItemType,
    videoFilename,
    sourceStartTime,
    sourceEndTime,
    text,
    scene,
    profile,
    pauseType,
  } = input;
  const allItems = yield* getOrderedItems(db, videoId);

  const targetIndex = allItems.findIndex(
    (item) => item.type === targetItemType && item.id === targetItemId
  );

  if (targetIndex === -1) {
    throw new Error(`Could not find target ${targetItemType}: ${targetItemId}`);
  }

  let prevOrder: string | null = null;
  let nextOrder: string | null = null;

  if (position === "before") {
    nextOrder = allItems[targetIndex]?.order ?? null;
    const prevItem = allItems[targetIndex - 1];
    prevOrder = prevItem?.order ?? null;
  } else {
    prevOrder = allItems[targetIndex]?.order ?? null;
    const nextItem = allItems[targetIndex + 1];
    nextOrder = nextItem?.order ?? null;
  }

  const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

  const [clip] = yield* dbCall(() =>
    db
      .insert(clips)
      .values({
        videoId,
        videoFilename,
        sourceStartTime,
        sourceEndTime,
        text,
        scene,
        profile,
        pauseType,
        order: order!,
        archived: false,
        transcribedAt: new Date(),
        transcriptionStatus: "done",
      })
      .returning()
  );

  if (!clip) {
    throw new Error("Failed to create effect clip");
  }

  yield* touchVideoUpdatedAt(db, videoId);

  logger.log(videoId, {
    type: "effect-clip-created",
    clipId: clip.id,
    text,
    scene,
    order: order!,
  });

  return clip;
});

// ============================================================================
// Handler: create-video-from-selection
// ============================================================================

export const handleCreateVideoFromSelection = Effect.fn(
  "handleCreateVideoFromSelection"
)(function* (
  db: Database,
  input: CreateVideoFromSelectionInput,
  logger: LoggerAdapter
) {
  const newVideo = yield* createVideoFromSelectionImpl(db, input);

  logger.log(input.sourceVideoId, {
    type: "video-created-from-selection",
    sourceVideoId: input.sourceVideoId,
    clipIds: [...input.clipIds],
    newVideoId: newVideo.id,
  });

  return newVideo;
});
