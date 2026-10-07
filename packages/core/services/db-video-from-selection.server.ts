import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import { chapters, clips, videos } from "../db/schema.js";
import { sortByOrder } from "../lib/sort-by-order.js";
import { clipChildrenWith, copyClipsOntoVideo } from "./copy-child-rows.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * Create video from selection: a new Video in the source's Lesson, holding
 * copies of the selected Clips and Chapters in their timeline order. In
 * "move" mode the originals are archived afterwards.
 *
 * A copied Clip carries everything that hangs off it (Transcript Words, Clip
 * Web Links, Overlays) through `copyClipsOntoVideo`. Which tables below a
 * Video this path copies, and why it leaves the rest, is
 * COPY_PATHS.createVideoFromSelection in version-copy-manifest.ts.
 *
 * The caller owns the transaction and the Draft guard (the clip service runs
 * this inside `withClipServiceWriteClosure`).
 */

const dbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

export const createVideoFromSelectionImpl = Effect.fn(
  "createVideoFromSelection"
)(function* (
  db: Database,
  input: {
    readonly sourceVideoId: string;
    readonly clipIds: ReadonlyArray<string>;
    readonly chapterIds: ReadonlyArray<string>;
    readonly title: string;
    readonly mode: "copy" | "move";
  }
) {
  const { sourceVideoId, clipIds, chapterIds, title, mode } = input;

  const sourceVideo = yield* dbCall(() =>
    db.query.videos.findFirst({ where: eq(videos.id, sourceVideoId) })
  );
  if (!sourceVideo) {
    return yield* new NotFoundError({
      type: "createVideoFromSelection",
      params: { sourceVideoId },
    });
  }

  const [newVideo] = yield* dbCall(() =>
    db
      .insert(videos)
      .values({
        title,
        originalFootagePath: title,
        lessonId: sourceVideo.lessonId,
        // A selection from a Short is a Short: the format drives the export
        // frame dimensions.
        format: sourceVideo.format,
      })
      .returning()
  );
  if (!newVideo) {
    return yield* new UnknownDBServiceError({
      cause: "No video was returned from the database",
    });
  }

  const selectedClips =
    clipIds.length === 0
      ? []
      : yield* dbCall(() =>
          db.query.clips.findMany({
            where: and(
              eq(clips.videoId, sourceVideoId),
              eq(clips.archived, false),
              inArray(clips.id, [...clipIds])
            ),
            with: clipChildrenWith,
          })
        );
  const selectedChapters =
    chapterIds.length === 0
      ? []
      : yield* dbCall(() =>
          db.query.chapters.findMany({
            where: and(
              eq(chapters.videoId, sourceVideoId),
              eq(chapters.archived, false),
              inArray(chapters.id, [...chapterIds])
            ),
          })
        );

  // The selection keeps its timeline order, under fresh order keys.
  const selected = sortByOrder([
    ...selectedClips.map((clip) => ({
      kind: "clip" as const,
      order: clip.order,
      clip,
    })),
    ...selectedChapters.map((chapter) => ({
      kind: "chapter" as const,
      order: chapter.order,
      chapter,
    })),
  ]);
  const orders = generateNKeysBetween(null, null, selected.length);
  const placed = selected.map((item, i) => ({ ...item, order: orders[i]! }));

  yield* dbCall(() =>
    copyClipsOntoVideo(
      db,
      placed.flatMap((item) =>
        item.kind === "clip"
          ? [{ clip: item.clip, videoId: newVideo.id, order: item.order }]
          : []
      )
    )
  );
  const chapterValues = placed.flatMap((item) =>
    item.kind === "chapter"
      ? [
          {
            videoId: newVideo.id,
            name: item.chapter.name,
            order: item.order,
            archived: false,
          },
        ]
      : []
  );
  if (chapterValues.length > 0) {
    yield* dbCall(() => db.insert(chapters).values(chapterValues));
  }

  if (mode === "move") {
    if (clipIds.length > 0) {
      yield* dbCall(() =>
        db
          .update(clips)
          .set({ archived: true })
          .where(inArray(clips.id, [...clipIds]))
      );
    }
    if (chapterIds.length > 0) {
      yield* dbCall(() =>
        db
          .update(chapters)
          .set({ archived: true })
          .where(inArray(chapters.id, [...chapterIds]))
      );
    }
    yield* dbCall(() =>
      db
        .update(videos)
        .set({ updatedAt: new Date() })
        .where(eq(videos.id, sourceVideoId))
    );
  }

  return newVideo;
});
