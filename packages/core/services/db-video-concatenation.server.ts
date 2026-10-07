import { and, eq, inArray } from "drizzle-orm";
import { clips, chapters } from "../db/schema.js";
import { compareOrderStrings } from "../lib/sort-by-order.js";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import type { VideoFormat } from "../features/videos/video-format.js";
import { clipChildrenWith, copyClipsOntoVideo } from "./copy-child-rows.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/**
 * Creates a new standalone video by concatenating clips from multiple source videos.
 *
 * For each source video, all non-archived clips and chapters are copied in order.
 * Boundary chapters are inserted between each source video, named after the source.
 * The resulting video is a normal standalone video (null lessonId).
 *
 * A copied Clip carries everything that hangs off it (Transcript Words, Clip
 * Web Links, Overlays) through `copyClipsOntoVideo`; which tables below a
 * Video this path copies is COPY_PATHS.concatenateVideos in
 * version-copy-manifest.ts.
 *
 * `format` is the Video Format the new Video is created with. It is REQUIRED:
 * the format drives the export frame dimensions, so a concatenation that
 * omitted it silently produced a landscape Video out of Short sources.
 */
export const concatenateVideos = Effect.fn("concatenateVideos")(
  function* (opts: {
    name: string;
    sourceVideoIds: string[];
    format: VideoFormat;
  }) {
    const { name, sourceVideoIds, format } = opts;
    const db = yield* DrizzleService;
    const videoOps = yield* VideoOperationsService;

    // Create the new standalone video
    const newVideo = yield* videoOps.createStandaloneVideo({
      title: name,
      format,
    });

    // Track the running order position across all sources
    let prevOrder: string | null = null;

    for (let i = 0; i < sourceVideoIds.length; i++) {
      const sourceVideoId = sourceVideoIds[i]!;

      // Load source video with clips and sections
      const sourceVideo = yield* videoOps.getVideoWithClipsById(sourceVideoId);

      // Insert boundary chapter between sources (not before the first)
      if (i > 0) {
        const [boundaryOrder] = generateNKeysBetween(prevOrder, null, 1);
        prevOrder = boundaryOrder!;

        yield* makeDbCall(() =>
          db.insert(chapters).values({
            videoId: newVideo.id,
            name: sourceVideo.title,
            order: prevOrder!,
            archived: false,
          })
        );
      }

      // The Video's non-archived Clips, reloaded with what hangs off each
      // one so the copy carries it, then sorted together with its Chapters.
      const sourceClipIds = sourceVideo.clips.map((c) => c.id);
      const sourceClips =
        sourceClipIds.length === 0
          ? []
          : yield* makeDbCall(() =>
              db.query.clips.findMany({
                where: and(
                  eq(clips.videoId, sourceVideoId),
                  inArray(clips.id, sourceClipIds)
                ),
                with: clipChildrenWith,
              })
            );
      const sourceChapters = sourceVideo.chapters; // already sorted by order, non-archived

      const allItems = [
        ...sourceClips.map((c) => ({
          type: "clip" as const,
          item: c,
          order: c.order,
        })),
        ...sourceChapters.map((s) => ({
          type: "chapter" as const,
          item: s,
          order: s.order,
        })),
      ].sort((a, b) => compareOrderStrings(a.order, b.order));

      // Generate new orders for all items in this source
      if (allItems.length > 0) {
        const newOrders = generateNKeysBetween(
          prevOrder,
          null,
          allItems.length
        );

        const placed = allItems.map((entry, j) => ({
          ...entry,
          newOrder: newOrders[j]!,
        }));

        yield* makeDbCall(() =>
          copyClipsOntoVideo(
            db,
            placed.flatMap((entry) =>
              entry.type === "clip"
                ? [
                    {
                      clip: entry.item,
                      videoId: newVideo.id,
                      order: entry.newOrder,
                    },
                  ]
                : []
            )
          )
        );

        const chapterValues = placed.flatMap((entry) =>
          entry.type === "chapter"
            ? [
                {
                  videoId: newVideo.id,
                  name: entry.item.name,
                  order: entry.newOrder,
                  archived: false,
                },
              ]
            : []
        );
        if (chapterValues.length > 0) {
          yield* makeDbCall(() => db.insert(chapters).values(chapterValues));
        }

        prevOrder = newOrders[newOrders.length - 1]!;
      }
    }

    return newVideo;
  }
);
