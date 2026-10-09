import type { Database } from "./drizzle-service.server.js";
import { clips, overlays, videos } from "../db/schema.js";
import {
  ClipCarriesOverlaysError,
  NotFoundError,
  UnknownDBServiceError,
} from "./db-service-errors.js";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  requireDraftVersionForClip,
  requireDraftVersionForVideo,
} from "./draft-guard.server.js";
import { orderKeyBeforeItem } from "../lib/sort-by-order.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

type ClipRow = typeof clips.$inferSelect;
type TimelineItem = { type: "clip" | "chapter"; id: string; order: string };

/**
 * Moving a Clip — within its own Video (`moveClipToPosition`) or onto another
 * (`moveClipToVideo`). Merged into `ClipOperationsService`'s single surface by
 * db-clip-operations.server.ts, split out only to stay under the per-file token
 * budget. Both read the timeline through `listTimelineOrder`, handed in rather
 * than duplicated.
 */
export const createClipMoveOperationsUnwrapped = (
  db: Database,
  deps: {
    getClipById: (
      clipId: string
    ) => Effect.Effect<ClipRow, NotFoundError | UnknownDBServiceError>;
    listTimelineOrder: (
      videoId: string
    ) => Effect.Effect<ReadonlyArray<TimelineItem>, UnknownDBServiceError>;
  }
) => {
  const { getClipById, listTimelineOrder } = deps;

  /**
   * Reposition a Clip to an explicit point in its Video's timeline order,
   * anchored immediately before `beforeItemId` (a Clip OR Chapter id, since
   * they share one order space) — `null` appends to the end.
   *
   * Unlike `reorderClip` (nudge one slot up/down), this jumps straight to an
   * arbitrary position. The CLI's `clip move --before/--after` resolves its
   * target id against `listTimelineOrder` and hands the result here.
   */
  const moveClipToPosition = Effect.fn("moveClipToPosition")(function* (
    clipId: string,
    beforeItemId: string | null
  ) {
    yield* requireDraftVersionForClip(db, clipId);
    const clip = yield* getClipById(clipId);

    const items = (yield* listTimelineOrder(clip.videoId)).filter(
      (item) => item.id !== clipId
    );

    const order = orderKeyBeforeItem(items, beforeItemId);
    if (order === null) {
      return yield* new NotFoundError({
        type: "moveClipToPosition",
        params: { clipId: beforeItemId },
      });
    }

    yield* makeDbCall(() =>
      db.update(clips).set({ order }).where(eq(clips.id, clipId))
    );

    return yield* getClipById(clipId);
  });

  /**
   * Move a Clip onto ANOTHER Video's timeline, anchored immediately before
   * `beforeItemId` (a Clip OR Chapter id on the TARGET Video) — `null` appends
   * to the end of the target's timeline.
   *
   * Only `videoId` and `order` change: the row keeps its id, text, scene,
   * profile, Diagram Snapshot and everything else, and its children (Transcript
   * Words, Web Links) hang off the clip id so they travel with it. No
   * copy, no delete, no transcript. The source Video needs no renumbering —
   * fractional order keys stay valid when an item leaves.
   *
   * Both ends are draft-guarded: the Clip's current Version and the target
   * Video's. A Clip that anchors Overlays is refused (ClipCarriesOverlaysError):
   * an Overlay cannot move to another Video.
   */
  const moveClipToVideo = Effect.fn("moveClipToVideo")(function* (
    clipId: string,
    targetVideoId: string,
    beforeItemId: string | null
  ) {
    yield* requireDraftVersionForClip(db, clipId);
    yield* getClipById(clipId);

    const anchored = yield* makeDbCall(() =>
      db.query.overlays.findMany({
        where: eq(overlays.clipId, clipId),
        columns: { id: true },
      })
    );
    if (anchored.length > 0) {
      return yield* new ClipCarriesOverlaysError({
        clipId,
        overlayCount: anchored.length,
        message:
          `clip ${clipId} anchors ${anchored.length} Overlay(s), and an Overlay ` +
          `cannot move to another Video — delete them first`,
      });
    }

    const target = yield* makeDbCall(() =>
      db.query.videos.findFirst({ where: eq(videos.id, targetVideoId) })
    );
    if (!target) {
      return yield* new NotFoundError({
        type: "moveClipToVideo",
        params: { videoId: targetVideoId },
      });
    }
    yield* requireDraftVersionForVideo(db, targetVideoId);

    const items = (yield* listTimelineOrder(targetVideoId)).filter(
      (item) => item.id !== clipId
    );

    const order = orderKeyBeforeItem(items, beforeItemId);
    if (order === null) {
      return yield* new NotFoundError({
        type: "moveClipToVideo",
        params: { clipId: beforeItemId },
      });
    }

    yield* makeDbCall(() =>
      db
        .update(clips)
        .set({ videoId: targetVideoId, order })
        .where(eq(clips.id, clipId))
    );

    return yield* getClipById(clipId);
  });

  return { moveClipToPosition, moveClipToVideo };
};
