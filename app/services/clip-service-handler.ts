/**
 * ClipService Handler
 *
 * This file contains the handler function that processes ClipServiceEvents
 * and the direct transport factory for testing.
 *
 * The handler pattern-matches on the event type and dispatches to the
 * appropriate database operations.
 */

import { clips, clipSections, videos } from "@/db/schema";
import type * as schema from "@/db/schema";
import { compareOrderStrings } from "@/lib/sort-by-order";
import { and, asc, eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { generateNKeysBetween } from "fractional-indexing";
import {
  createClipService,
  type ClipService,
  type ClipServiceEvent,
  type TimelineItem,
} from "./clip-service";

// ============================================================================
// Types
// ============================================================================

type DrizzleDB = PgliteDatabase<typeof schema>;

// ============================================================================
// Helper: Get all items for a video sorted by order
// ============================================================================

async function getOrderedItems(db: DrizzleDB, videoId: string) {
  const allClips = await db.query.clips.findMany({
    where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
    orderBy: asc(clips.order),
  });

  const allClipSections = await db.query.clipSections.findMany({
    where: and(
      eq(clipSections.videoId, videoId),
      eq(clipSections.archived, false)
    ),
    orderBy: asc(clipSections.order),
  });

  const allItems = [
    ...allClips.map((c) => ({ type: "clip" as const, ...c })),
    ...allClipSections.map((cs) => ({
      type: "clip-section" as const,
      ...cs,
    })),
  ].sort((a, b) => compareOrderStrings(a.order, b.order));

  return allItems;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handles a ClipServiceEvent by dispatching to the appropriate database operation.
 * This is the core business logic that both HTTP and direct transports use.
 */
export async function handleClipServiceEvent(
  db: DrizzleDB,
  event: ClipServiceEvent
): Promise<unknown> {
  switch (event.type) {
    case "create-video": {
      const [video] = await db
        .insert(videos)
        .values({
          path: event.path,
          originalFootagePath: "",
          lessonId: null,
        })
        .returning();

      if (!video) {
        throw new Error("Failed to create video");
      }

      return video;
    }

    case "get-timeline": {
      const allItems = await getOrderedItems(db, event.videoId);

      const timeline: TimelineItem[] = allItems.map((item) => {
        if (item.type === "clip") {
          const { type, ...clipData } = item;
          return { type: "clip", data: clipData };
        } else {
          const { type, ...sectionData } = item;
          return { type: "clip-section", data: sectionData };
        }
      });

      return timeline;
    }

    case "append-clips": {
      const { videoId, insertionPoint, clips: inputClips } = event.input;
      const allItems = await getOrderedItems(db, videoId);

      let prevOrder: string | null = null;
      let nextOrder: string | null = null;

      if (insertionPoint.type === "start") {
        const firstItem = allItems[0];
        nextOrder = firstItem?.order ?? null;
      } else if (insertionPoint.type === "after-clip") {
        const insertAfterClipIndex = allItems.findIndex(
          (item) =>
            item.type === "clip" && item.id === insertionPoint.databaseClipId
        );

        if (insertAfterClipIndex === -1) {
          throw new Error(
            `Could not find a clip to insert after: ${insertionPoint.databaseClipId}`
          );
        }

        const insertAfterItem = allItems[insertAfterClipIndex];
        prevOrder = insertAfterItem?.order ?? null;

        const nextItem = allItems[insertAfterClipIndex + 1];
        nextOrder = nextItem?.order ?? null;
      } else if (insertionPoint.type === "after-clip-section") {
        const insertAfterSectionIndex = allItems.findIndex(
          (item) =>
            item.type === "clip-section" &&
            item.id === insertionPoint.clipSectionId
        );

        if (insertAfterSectionIndex === -1) {
          throw new Error(
            `Could not find a clip section to insert after: ${insertionPoint.clipSectionId}`
          );
        }

        const insertAfterItem = allItems[insertAfterSectionIndex];
        prevOrder = insertAfterItem?.order ?? null;

        const nextItem = allItems[insertAfterSectionIndex + 1];
        nextOrder = nextItem?.order ?? null;
      }

      const orders = generateNKeysBetween(
        prevOrder,
        nextOrder,
        inputClips.length
      );

      const clipsResult = await db
        .insert(clips)
        .values(
          inputClips.map((clip, index) => ({
            videoId,
            videoFilename: clip.inputVideo,
            sourceStartTime: clip.startTime,
            sourceEndTime: clip.endTime,
            order: orders[index]!,
            archived: false,
            text: "",
          }))
        )
        .returning();

      return clipsResult;
    }

    case "append-from-obs": {
      // TODO: Implement OBS append flow
      // This will be implemented in a later task
      throw new Error("Not implemented: append-from-obs");
    }

    case "archive-clips": {
      for (const clipId of event.clipIds) {
        await db
          .update(clips)
          .set({ archived: true })
          .where(eq(clips.id, clipId));
      }
      return;
    }

    case "update-clips": {
      for (const clip of event.clips) {
        await db
          .update(clips)
          .set({
            scene: clip.scene,
            profile: clip.profile,
            beatType: clip.beatType,
          })
          .where(eq(clips.id, clip.id));
      }
      return;
    }

    case "update-beat": {
      await db
        .update(clips)
        .set({ beatType: event.beatType })
        .where(eq(clips.id, event.clipId));
      return;
    }

    case "reorder-clip": {
      const clip = await db.query.clips.findFirst({
        where: eq(clips.id, event.clipId),
      });

      if (!clip) {
        throw new Error(`Clip not found: ${event.clipId}`);
      }

      const allItems = await getOrderedItems(db, clip.videoId);

      const itemIndex = allItems.findIndex(
        (item) => item.type === "clip" && item.id === event.clipId
      );
      const targetIndex =
        event.direction === "up" ? itemIndex - 1 : itemIndex + 1;

      if (targetIndex < 0 || targetIndex >= allItems.length) {
        return;
      }

      let newOrder: string;
      if (event.direction === "up") {
        const prevItem = allItems[targetIndex - 1];
        const nextItem = allItems[targetIndex];
        const prevOrder = prevItem?.order ?? null;
        const nextOrder = nextItem!.order;
        const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);
        newOrder = order!;
      } else {
        const prevItem = allItems[targetIndex];
        const nextItem = allItems[targetIndex + 1];
        const prevOrder = prevItem!.order;
        const nextOrder = nextItem?.order ?? null;
        const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);
        newOrder = order!;
      }

      await db
        .update(clips)
        .set({ order: newOrder })
        .where(eq(clips.id, event.clipId));
      return;
    }

    case "create-clip-section-at-insertion-point": {
      const { videoId, name, insertionPoint } = event.input;
      const allItems = await getOrderedItems(db, videoId);

      let prevOrder: string | null = null;
      let nextOrder: string | null = null;

      if (insertionPoint.type === "start") {
        const firstItem = allItems[0];
        nextOrder = firstItem?.order ?? null;
      } else if (insertionPoint.type === "after-clip") {
        const insertAfterClipIndex = allItems.findIndex(
          (item) =>
            item.type === "clip" && item.id === insertionPoint.databaseClipId
        );

        if (insertAfterClipIndex === -1) {
          throw new Error(
            `Could not find a clip to insert after: ${insertionPoint.databaseClipId}`
          );
        }

        const insertAfterItem = allItems[insertAfterClipIndex];
        prevOrder = insertAfterItem?.order ?? null;

        const nextItem = allItems[insertAfterClipIndex + 1];
        nextOrder = nextItem?.order ?? null;
      } else if (insertionPoint.type === "after-clip-section") {
        const insertAfterSectionIndex = allItems.findIndex(
          (item) =>
            item.type === "clip-section" &&
            item.id === insertionPoint.clipSectionId
        );

        if (insertAfterSectionIndex === -1) {
          throw new Error(
            `Could not find a clip section to insert after: ${insertionPoint.clipSectionId}`
          );
        }

        const insertAfterItem = allItems[insertAfterSectionIndex];
        prevOrder = insertAfterItem?.order ?? null;

        const nextItem = allItems[insertAfterSectionIndex + 1];
        nextOrder = nextItem?.order ?? null;
      }

      const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

      const [clipSection] = await db
        .insert(clipSections)
        .values({
          videoId,
          name,
          order: order!,
          archived: false,
        })
        .returning();

      if (!clipSection) {
        throw new Error("Failed to create clip section");
      }

      return clipSection;
    }

    case "create-clip-section-at-position": {
      const { videoId, name, position, targetItemId, targetItemType } =
        event.input;
      const allItems = await getOrderedItems(db, videoId);

      const targetIndex = allItems.findIndex(
        (item) => item.type === targetItemType && item.id === targetItemId
      );

      if (targetIndex === -1) {
        throw new Error(
          `Could not find target ${targetItemType}: ${targetItemId}`
        );
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

      const [clipSection] = await db
        .insert(clipSections)
        .values({
          videoId,
          name,
          order: order!,
          archived: false,
        })
        .returning();

      if (!clipSection) {
        throw new Error("Failed to create clip section");
      }

      return clipSection;
    }

    case "update-clip-section": {
      await db
        .update(clipSections)
        .set({ name: event.name })
        .where(eq(clipSections.id, event.clipSectionId));
      return;
    }

    case "archive-clip-sections": {
      for (const clipSectionId of event.clipSectionIds) {
        await db
          .update(clipSections)
          .set({ archived: true })
          .where(eq(clipSections.id, clipSectionId));
      }
      return;
    }

    case "reorder-clip-section": {
      const clipSection = await db.query.clipSections.findFirst({
        where: eq(clipSections.id, event.clipSectionId),
      });

      if (!clipSection) {
        throw new Error(`Clip section not found: ${event.clipSectionId}`);
      }

      const allItems = await getOrderedItems(db, clipSection.videoId);

      const itemIndex = allItems.findIndex(
        (item) =>
          item.type === "clip-section" && item.id === event.clipSectionId
      );
      const targetIndex =
        event.direction === "up" ? itemIndex - 1 : itemIndex + 1;

      if (targetIndex < 0 || targetIndex >= allItems.length) {
        return;
      }

      let newOrder: string;
      if (event.direction === "up") {
        const prevItem = allItems[targetIndex - 1];
        const nextItem = allItems[targetIndex];
        const prevOrder = prevItem?.order ?? null;
        const nextOrder = nextItem!.order;
        const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);
        newOrder = order!;
      } else {
        const prevItem = allItems[targetIndex];
        const nextItem = allItems[targetIndex + 1];
        const prevOrder = prevItem!.order;
        const nextOrder = nextItem?.order ?? null;
        const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);
        newOrder = order!;
      }

      await db
        .update(clipSections)
        .set({ order: newOrder })
        .where(eq(clipSections.id, event.clipSectionId));
      return;
    }

    default: {
      const _exhaustive: never = event;
      throw new Error(`Unknown event type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ============================================================================
// Direct Transport Factory (for tests)
// ============================================================================

/**
 * Creates a ClipService that calls the handler directly with the provided
 * database instance. Used for testing with PGlite.
 */
export function createDirectClipService(db: DrizzleDB): ClipService {
  const send = async (event: ClipServiceEvent): Promise<unknown> => {
    return handleClipServiceEvent(db, event);
  };

  return createClipService(send);
}
