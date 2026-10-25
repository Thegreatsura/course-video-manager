import { clips, chapters } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import type { Database } from "@/services/drizzle-service.server";
import type { ClipServiceEventOf } from "./clip-service";
import {
  type LoggerAdapter,
  dbCall,
  getOrderedItems,
  touchVideoUpdatedAt,
} from "./clip-service-handler.helpers";

type TimelineItems = Effect.Effect.Success<ReturnType<typeof getOrderedItems>>;
type Direction = ClipServiceEventOf<"reorder-clip">["direction"];

/**
 * The order that moves the item at `itemIndex` one step `direction` along
 * the Timeline, or null when it is already at that end.
 */
const orderOneStepAlong = (
  allItems: TimelineItems,
  itemIndex: number,
  direction: Direction
): string | null => {
  const targetIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;

  if (targetIndex < 0 || targetIndex >= allItems.length) {
    return null;
  }

  const [order] =
    direction === "up"
      ? generateNKeysBetween(
          allItems[targetIndex - 1]?.order ?? null,
          allItems[targetIndex]!.order,
          1
        )
      : generateNKeysBetween(
          allItems[targetIndex]!.order,
          allItems[targetIndex + 1]?.order ?? null,
          1
        );
  return order!;
};

/** Move a Clip one step up or down its Video's Timeline. */
export const reorderClip = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"reorder-clip">
) =>
  Effect.gen(function* () {
    const clip = yield* dbCall(() =>
      db.query.clips.findFirst({
        where: eq(clips.id, event.clipId),
      })
    );

    if (!clip) {
      throw new Error(`Clip not found: ${event.clipId}`);
    }

    const allItems = yield* getOrderedItems(db, clip.videoId);

    const itemIndex = allItems.findIndex(
      (item) => item.type === "clip" && item.id === event.clipId
    );
    const newOrder = orderOneStepAlong(allItems, itemIndex, event.direction);
    if (newOrder === null) {
      return;
    }

    yield* dbCall(() =>
      db
        .update(clips)
        .set({ order: newOrder })
        .where(eq(clips.id, event.clipId))
    );

    yield* touchVideoUpdatedAt(db, clip.videoId);

    logger.log(clip.videoId, {
      type: "clip-reordered",
      clipId: event.clipId,
      direction: event.direction,
    });
  });

/** Move a Chapter one step up or down its Video's Timeline. */
export const reorderChapter = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"reorder-chapter">
) =>
  Effect.gen(function* () {
    const chapter = yield* dbCall(() =>
      db.query.chapters.findFirst({
        where: eq(chapters.id, event.chapterId),
      })
    );

    if (!chapter) {
      throw new Error(`Chapter not found: ${event.chapterId}`);
    }

    const allItems = yield* getOrderedItems(db, chapter.videoId);

    const itemIndex = allItems.findIndex(
      (item) => item.type === "chapter" && item.id === event.chapterId
    );
    const newOrder = orderOneStepAlong(allItems, itemIndex, event.direction);
    if (newOrder === null) {
      return;
    }

    yield* dbCall(() =>
      db
        .update(chapters)
        .set({ order: newOrder })
        .where(eq(chapters.id, event.chapterId))
    );

    yield* touchVideoUpdatedAt(db, chapter.videoId);

    logger.log(chapter.videoId, {
      type: "chapter-reordered",
      chapterId: event.chapterId,
      direction: event.direction,
    });
  });
