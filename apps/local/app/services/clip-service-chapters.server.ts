import { chapters } from "@/db/schema";
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
type InsertionPoint =
  ClipServiceEventOf<"create-chapter-at-insertion-point">["input"]["insertionPoint"];

interface OrderBounds {
  prevOrder: string | null;
  nextOrder: string | null;
}

/** The orders either side of the Timeline item at `index`. */
const boundsAfterIndex = (
  allItems: TimelineItems,
  index: number
): OrderBounds => ({
  prevOrder: allItems[index]?.order ?? null,
  nextOrder: allItems[index + 1]?.order ?? null,
});

const indexOrThrow = (index: number, message: string) => {
  if (index === -1) {
    throw new Error(message);
  }
  return index;
};

/** The orders a Chapter created at `insertionPoint` goes between. */
const boundsAtInsertionPoint = (
  allItems: TimelineItems,
  insertionPoint: InsertionPoint
): OrderBounds => {
  if (insertionPoint.type === "start") {
    return { prevOrder: null, nextOrder: allItems[0]?.order ?? null };
  }
  if (insertionPoint.type === "after-clip") {
    const index = allItems.findIndex(
      (item) =>
        item.type === "clip" && item.id === insertionPoint.databaseClipId
    );
    return boundsAfterIndex(
      allItems,
      indexOrThrow(
        index,
        `Could not find a clip to insert after: ${insertionPoint.databaseClipId}`
      )
    );
  }
  if (insertionPoint.type === "after-chapter") {
    const index = allItems.findIndex(
      (item) => item.type === "chapter" && item.id === insertionPoint.chapterId
    );
    return boundsAfterIndex(
      allItems,
      indexOrThrow(
        index,
        `Could not find a chapter to insert after: ${insertionPoint.chapterId}`
      )
    );
  }
  return { prevOrder: null, nextOrder: null };
};

/** Insert a Chapter between two orders, touch its Video and log it. */
const insertChapterBetween = (
  db: Database,
  logger: LoggerAdapter,
  input: { videoId: string; name: string } & OrderBounds
) =>
  Effect.gen(function* () {
    const { videoId, name, prevOrder, nextOrder } = input;
    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    const [chapter] = yield* dbCall(() =>
      db
        .insert(chapters)
        .values({
          videoId,
          name,
          order: order!,
          archived: false,
        })
        .returning()
    );

    if (!chapter) {
      throw new Error("Failed to create chapter");
    }

    yield* touchVideoUpdatedAt(db, videoId);

    logger.log(videoId, {
      type: "chapter-created",
      sectionId: chapter.id,
      name,
      order: order!,
    });

    return chapter;
  });

export const createChapterAtInsertionPoint = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"create-chapter-at-insertion-point">
) =>
  Effect.gen(function* () {
    const { videoId, name, insertionPoint } = event.input;
    const allItems = yield* getOrderedItems(db, videoId);
    const bounds = boundsAtInsertionPoint(allItems, insertionPoint);
    return yield* insertChapterBetween(db, logger, {
      videoId,
      name,
      ...bounds,
    });
  });

export const createChapterAtPosition = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"create-chapter-at-position">
) =>
  Effect.gen(function* () {
    const { videoId, name, position, targetItemId, targetItemType } =
      event.input;
    const allItems = yield* getOrderedItems(db, videoId);

    const targetIndex = indexOrThrow(
      allItems.findIndex(
        (item) => item.type === targetItemType && item.id === targetItemId
      ),
      `Could not find target ${targetItemType}: ${targetItemId}`
    );

    const bounds =
      position === "before"
        ? boundsAfterIndex(allItems, targetIndex - 1)
        : boundsAfterIndex(allItems, targetIndex);

    return yield* insertChapterBetween(db, logger, {
      videoId,
      name,
      ...bounds,
    });
  });

export const updateChapter = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"update-chapter">
) =>
  Effect.gen(function* () {
    yield* dbCall(() =>
      db
        .update(chapters)
        .set({ name: event.name })
        .where(eq(chapters.id, event.chapterId))
    );

    const section = yield* dbCall(() =>
      db.query.chapters.findFirst({
        where: eq(chapters.id, event.chapterId),
      })
    );
    if (section) {
      yield* touchVideoUpdatedAt(db, section.videoId);
      logger.log(section.videoId, {
        type: "chapter-updated",
        chapterId: event.chapterId,
        name: event.name,
      });
    }
  });

export const archiveChapters = (
  db: Database,
  logger: LoggerAdapter,
  event: ClipServiceEventOf<"archive-chapters">
) =>
  Effect.gen(function* () {
    for (const chapterId of event.chapterIds) {
      yield* dbCall(() =>
        db
          .update(chapters)
          .set({ archived: true })
          .where(eq(chapters.id, chapterId))
      );
    }

    if (event.chapterIds.length > 0) {
      const firstSection = yield* dbCall(() =>
        db.query.chapters.findFirst({
          where: eq(chapters.id, event.chapterIds[0]!),
        })
      );
      if (firstSection) {
        yield* touchVideoUpdatedAt(db, firstSection.videoId);
        logger.log(firstSection.videoId, {
          type: "chapters-archived",
          chapterIds: [...event.chapterIds],
        });
      }
    }
  });
