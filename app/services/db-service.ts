import { DrizzleService } from "@/services/drizzle-service";
import {
  clips,
  clipSections,
  lessons,
  links,
  planLessons,
  plans,
  planSections,
  repos,
  repoVersions,
  sections,
  thumbnails,
  videos,
  youtubeAuth,
} from "@/db/schema";
import {
  AmbiguousRepoUpdateError,
  CannotArchiveLessonVideoError,
  CannotDeleteNonLatestVersionError,
  CannotDeleteOnlyVersionError,
  NotFoundError,
  NotLatestVersionError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

import { compareOrderStrings } from "@/lib/sort-by-order";

export class DBFunctionsService extends Effect.Service<DBFunctionsService>()(
  "DBFunctionsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;

      const getClipById = Effect.fn("getClipById")(function* (clipId: string) {
        const clip = yield* makeDbCall(() =>
          db.query.clips.findFirst({
            where: eq(clips.id, clipId),
          })
        );

        if (!clip) {
          return yield* new NotFoundError({
            type: "getClipById",
            params: { clipId },
          });
        }

        return clip;
      });

      const getClipsByIds = Effect.fn("getClipsByIds")(function* (
        clipIds: readonly string[]
      ) {
        const foundClips = yield* makeDbCall(() =>
          db.query.clips.findMany({
            where: inArray(clips.id, clipIds),
          })
        );

        return foundClips;
      });

      const updateClip = Effect.fn("updateClip")(function* (
        clipId: string,
        updatedClip: {
          text?: string;
          scene?: string;
          profile?: string;
          transcribedAt?: Date;
          beatType?: string;
        }
      ) {
        const [clip] = yield* makeDbCall(() =>
          db
            .update(clips)
            .set(updatedClip)
            .where(eq(clips.id, clipId))
            .returning()
        );

        return clip!;
      });

      const archiveClip = Effect.fn("archiveClip")(function* (clipId: string) {
        const clipExists = yield* makeDbCall(() =>
          db.query.clips.findFirst({
            where: eq(clips.id, clipId),
          })
        );

        if (!clipExists) {
          return yield* new NotFoundError({
            type: "archiveClip",
            params: { clipId },
          });
        }

        const clip = yield* makeDbCall(() =>
          db.update(clips).set({ archived: true }).where(eq(clips.id, clipId))
        );

        return clip;
      });

      const reorderClip = Effect.fn("reorderClip")(function* (
        clipId: string,
        direction: "up" | "down"
      ) {
        // First, get the clip to know what video we're working with
        const clip = yield* makeDbCall(() =>
          db.query.clips.findFirst({
            where: eq(clips.id, clipId),
          })
        );

        if (!clip) {
          return yield* new NotFoundError({
            type: "reorderClip",
            params: { clipId },
          });
        }

        // Get all non-archived clips and clip sections for this video
        // We need both because clips and clip sections share the same ordering space
        const allClips = yield* makeDbCall(() =>
          db.query.clips.findMany({
            where: and(
              eq(clips.videoId, clip.videoId),
              eq(clips.archived, false)
            ),
            orderBy: asc(clips.order),
          })
        );

        const allClipSections = yield* makeDbCall(() =>
          db.query.clipSections.findMany({
            where: and(
              eq(clipSections.videoId, clip.videoId),
              eq(clipSections.archived, false)
            ),
            orderBy: asc(clipSections.order),
          })
        );

        // Combine and sort by order - clips and clip sections share the same ordering space
        const allItems = [
          ...allClips.map((c) => ({ type: "clip" as const, ...c })),
          ...allClipSections.map((cs) => ({
            type: "clip-section" as const,
            ...cs,
          })),
        ].sort((a, b) => compareOrderStrings(a.order, b.order));

        const itemIndex = allItems.findIndex(
          (item) => item.type === "clip" && item.id === clipId
        );
        const targetIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;

        // Check boundaries
        if (targetIndex < 0 || targetIndex >= allItems.length) {
          return { success: false, reason: "boundary" };
        }

        // Calculate new order based on neighbors in the combined list
        let newOrder: string;
        if (direction === "up") {
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

        yield* makeDbCall(() =>
          db.update(clips).set({ order: newOrder }).where(eq(clips.id, clipId))
        );

        return { success: true };
      });

      const createClipSection = Effect.fn("createClipSection")(function* (
        videoId: string,
        name: string,
        order: string
      ) {
        const [clipSection] = yield* makeDbCall(() =>
          db
            .insert(clipSections)
            .values({
              videoId,
              name,
              order,
              archived: false,
            })
            .returning()
        );

        if (!clipSection) {
          return yield* new UnknownDBServiceError({
            cause: "No clip section was returned from the database",
          });
        }

        return clipSection;
      });

      const createClipSectionAtInsertionPoint = Effect.fn(
        "createClipSectionAtInsertionPoint"
      )(function* (
        videoId: string,
        name: string,
        insertionPoint:
          | { type: "start" }
          | { type: "after-clip"; databaseClipId: string }
          | { type: "after-clip-section"; clipSectionId: string }
      ) {
        // Get all non-archived clips and clip sections for this video, ordered
        const allClips = yield* makeDbCall(() =>
          db.query.clips.findMany({
            where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
            orderBy: asc(clips.order),
          })
        );

        const allClipSections = yield* makeDbCall(() =>
          db.query.clipSections.findMany({
            where: and(
              eq(clipSections.videoId, videoId),
              eq(clipSections.archived, false)
            ),
            orderBy: asc(clipSections.order),
          })
        );

        // Combine and sort by order
        const allItems = [
          ...allClips.map((c) => ({ type: "clip" as const, ...c })),
          ...allClipSections.map((cs) => ({
            type: "clip-section" as const,
            ...cs,
          })),
        ].sort((a, b) => compareOrderStrings(a.order, b.order));

        // Calculate order based on insertion point
        let prevOrder: string | null = null;
        let nextOrder: string | null = null;

        if (insertionPoint.type === "start") {
          // Insert before all items
          const firstItem = allItems[0];
          nextOrder = firstItem?.order ?? null;
        } else if (insertionPoint.type === "after-clip") {
          // Insert after specific clip
          const insertAfterClipIndex = allItems.findIndex(
            (item) =>
              item.type === "clip" && item.id === insertionPoint.databaseClipId
          );

          if (insertAfterClipIndex === -1) {
            return yield* new NotFoundError({
              type: "createClipSectionAtInsertionPoint",
              params: { videoId, insertionPoint },
              message: `Could not find a clip to insert after`,
            });
          }

          const insertAfterItem = allItems[insertAfterClipIndex];
          prevOrder = insertAfterItem?.order ?? null;

          const nextItem = allItems[insertAfterClipIndex + 1];
          nextOrder = nextItem?.order ?? null;
        } else if (insertionPoint.type === "after-clip-section") {
          // Insert after specific clip section
          const insertAfterSectionIndex = allItems.findIndex(
            (item) =>
              item.type === "clip-section" &&
              item.id === insertionPoint.clipSectionId
          );

          if (insertAfterSectionIndex === -1) {
            return yield* new NotFoundError({
              type: "createClipSectionAtInsertionPoint",
              params: { videoId, insertionPoint },
              message: `Could not find a clip section to insert after`,
            });
          }

          const insertAfterItem = allItems[insertAfterSectionIndex];
          prevOrder = insertAfterItem?.order ?? null;

          const nextItem = allItems[insertAfterSectionIndex + 1];
          nextOrder = nextItem?.order ?? null;
        }

        const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

        const [clipSection] = yield* makeDbCall(() =>
          db
            .insert(clipSections)
            .values({
              videoId,
              name,
              order: order!,
              archived: false,
            })
            .returning()
        );

        if (!clipSection) {
          return yield* new UnknownDBServiceError({
            cause: "No clip section was returned from the database",
          });
        }

        return clipSection;
      });

      const createClipSectionAtPosition = Effect.fn(
        "createClipSectionAtPosition"
      )(function* (
        videoId: string,
        name: string,
        position: "before" | "after",
        targetItemId: string,
        targetItemType: "clip" | "clip-section"
      ) {
        // Get all non-archived clips and clip sections for this video, ordered
        const allClips = yield* makeDbCall(() =>
          db.query.clips.findMany({
            where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
            orderBy: asc(clips.order),
          })
        );

        const allClipSections = yield* makeDbCall(() =>
          db.query.clipSections.findMany({
            where: and(
              eq(clipSections.videoId, videoId),
              eq(clipSections.archived, false)
            ),
            orderBy: asc(clipSections.order),
          })
        );

        // Combine and sort by order
        const allItems = [
          ...allClips.map((c) => ({ type: "clip" as const, ...c })),
          ...allClipSections.map((cs) => ({
            type: "clip-section" as const,
            ...cs,
          })),
        ].sort((a, b) => compareOrderStrings(a.order, b.order));

        // Find the target item
        const targetIndex = allItems.findIndex(
          (item) => item.type === targetItemType && item.id === targetItemId
        );

        if (targetIndex === -1) {
          return yield* new NotFoundError({
            type: "createClipSectionAtPosition",
            params: { videoId, targetItemId, targetItemType },
            message: `Could not find the target ${targetItemType} to position relative to`,
          });
        }

        // Calculate order based on position
        let prevOrder: string | null = null;
        let nextOrder: string | null = null;

        if (position === "before") {
          // Insert before target item
          nextOrder = allItems[targetIndex]?.order ?? null;
          const prevItem = allItems[targetIndex - 1];
          prevOrder = prevItem?.order ?? null;
        } else {
          // Insert after target item
          prevOrder = allItems[targetIndex]?.order ?? null;
          const nextItem = allItems[targetIndex + 1];
          nextOrder = nextItem?.order ?? null;
        }

        const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

        const [clipSection] = yield* makeDbCall(() =>
          db
            .insert(clipSections)
            .values({
              videoId,
              name,
              order: order!,
              archived: false,
            })
            .returning()
        );

        if (!clipSection) {
          return yield* new UnknownDBServiceError({
            cause: "No clip section was returned from the database",
          });
        }

        return clipSection;
      });

      const getClipSectionById = Effect.fn("getClipSectionById")(function* (
        clipSectionId: string
      ) {
        const clipSection = yield* makeDbCall(() =>
          db.query.clipSections.findFirst({
            where: eq(clipSections.id, clipSectionId),
          })
        );

        if (!clipSection) {
          return yield* new NotFoundError({
            type: "getClipSectionById",
            params: { clipSectionId },
          });
        }

        return clipSection;
      });

      const updateClipSection = Effect.fn("updateClipSection")(function* (
        clipSectionId: string,
        updates: {
          name?: string;
        }
      ) {
        const [clipSection] = yield* makeDbCall(() =>
          db
            .update(clipSections)
            .set(updates)
            .where(eq(clipSections.id, clipSectionId))
            .returning()
        );

        if (!clipSection) {
          return yield* new NotFoundError({
            type: "updateClipSection",
            params: { clipSectionId },
          });
        }

        return clipSection;
      });

      const archiveClipSection = Effect.fn("archiveClipSection")(function* (
        clipSectionId: string
      ) {
        const clipSectionExists = yield* makeDbCall(() =>
          db.query.clipSections.findFirst({
            where: eq(clipSections.id, clipSectionId),
          })
        );

        if (!clipSectionExists) {
          return yield* new NotFoundError({
            type: "archiveClipSection",
            params: { clipSectionId },
          });
        }

        yield* makeDbCall(() =>
          db
            .update(clipSections)
            .set({ archived: true })
            .where(eq(clipSections.id, clipSectionId))
        );

        return { success: true };
      });

      const reorderClipSection = Effect.fn("reorderClipSection")(function* (
        clipSectionId: string,
        direction: "up" | "down"
      ) {
        // Get the clip section to know what video we're working with
        const clipSection = yield* makeDbCall(() =>
          db.query.clipSections.findFirst({
            where: eq(clipSections.id, clipSectionId),
          })
        );

        if (!clipSection) {
          return yield* new NotFoundError({
            type: "reorderClipSection",
            params: { clipSectionId },
          });
        }

        // Get all non-archived clips and clip sections for this video, ordered
        const allClips = yield* makeDbCall(() =>
          db.query.clips.findMany({
            where: and(
              eq(clips.videoId, clipSection.videoId),
              eq(clips.archived, false)
            ),
            orderBy: asc(clips.order),
          })
        );

        const allClipSections = yield* makeDbCall(() =>
          db.query.clipSections.findMany({
            where: and(
              eq(clipSections.videoId, clipSection.videoId),
              eq(clipSections.archived, false)
            ),
            orderBy: asc(clipSections.order),
          })
        );

        // Combine and sort by order
        const allItems = [
          ...allClips.map((c) => ({ type: "clip" as const, ...c })),
          ...allClipSections.map((cs) => ({
            type: "clip-section" as const,
            ...cs,
          })),
        ].sort((a, b) => compareOrderStrings(a.order, b.order));

        const itemIndex = allItems.findIndex(
          (item) => item.type === "clip-section" && item.id === clipSectionId
        );
        const targetIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;

        // Check boundaries
        if (targetIndex < 0 || targetIndex >= allItems.length) {
          return { success: false, reason: "boundary" };
        }

        // Calculate new order
        let newOrder: string;
        if (direction === "up") {
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

        yield* makeDbCall(() =>
          db
            .update(clipSections)
            .set({ order: newOrder })
            .where(eq(clipSections.id, clipSectionId))
        );

        return { success: true };
      });

      const getRepoById = Effect.fn("getRepoById")(function* (id: string) {
        const repo = yield* makeDbCall(() =>
          db.query.repos.findFirst({
            where: eq(repos.id, id),
          })
        );

        if (!repo) {
          return yield* new NotFoundError({
            type: "getRepo",
            params: { id },
          });
        }

        return repo;
      });

      const getRepoByFilePath = Effect.fn("getRepoByFilePath")(function* (
        filePath: string
      ) {
        const repo = yield* makeDbCall(() =>
          db.query.repos.findFirst({
            where: eq(repos.filePath, filePath),
          })
        );

        if (!repo) {
          return yield* new NotFoundError({
            type: "getRepoByFilePath",
            params: { filePath },
          });
        }

        return repo;
      });

      const getLessonById = Effect.fn("getLessonById")(function* (id: string) {
        const lesson = yield* makeDbCall(() =>
          db.query.lessons.findFirst({
            where: eq(lessons.id, id),
            with: {
              videos: {
                orderBy: asc(videos.path),
              },
            },
          })
        );

        if (!lesson) {
          return yield* new NotFoundError({
            type: "getLessonById",
            params: { id },
          });
        }

        return lesson;
      });

      const getLessonWithHierarchyById = Effect.fn(
        "getLessonWithHierarchyById"
      )(function* (id: string) {
        const lesson = yield* makeDbCall(() =>
          db.query.lessons.findFirst({
            where: eq(lessons.id, id),
            with: {
              section: {
                with: {
                  repoVersion: {
                    with: {
                      repo: true,
                    },
                  },
                },
              },
            },
          })
        );

        if (!lesson) {
          return yield* new NotFoundError({
            type: "getLessonWithHierarchyById",
            params: { id },
          });
        }

        return lesson;
      });

      const getVideoDeepById = Effect.fn("getVideoById")(function* (
        id: string
      ) {
        const video = yield* makeDbCall(() =>
          db.query.videos.findFirst({
            where: eq(videos.id, id),
            with: {
              lesson: {
                with: {
                  section: {
                    with: {
                      repoVersion: {
                        with: {
                          repo: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          })
        );

        if (!video) {
          return yield* new NotFoundError({
            type: "getVideoById",
            params: { id },
          });
        }

        return video;
      });

      const getStandaloneVideos = Effect.fn("getStandaloneVideos")(
        function* () {
          const standaloneVideos = yield* makeDbCall(() =>
            db.query.videos.findMany({
              where: and(isNull(videos.lessonId), eq(videos.archived, false)),
              orderBy: desc(videos.createdAt),
              with: {
                clips: {
                  orderBy: asc(clips.order),
                  where: eq(clips.archived, false),
                },
              },
            })
          );

          return standaloneVideos;
        }
      );

      const getArchivedStandaloneVideos = Effect.fn(
        "getArchivedStandaloneVideos"
      )(function* () {
        const archivedVideos = yield* makeDbCall(() =>
          db.query.videos.findMany({
            where: and(isNull(videos.lessonId), eq(videos.archived, true)),
            orderBy: desc(videos.createdAt),
            with: {
              clips: {
                orderBy: asc(clips.order),
                where: eq(clips.archived, false),
              },
            },
          })
        );

        return archivedVideos;
      });

      const getVideoWithClipsById = Effect.fn("getVideoWithClipsById")(
        function* (
          id: string,
          opts?: {
            withArchived?: boolean;
          }
        ) {
          const video = yield* makeDbCall(() =>
            db.query.videos.findFirst({
              where: eq(videos.id, id),
              with: {
                lesson: {
                  with: {
                    section: {
                      with: {
                        repoVersion: {
                          with: {
                            repo: true,
                          },
                        },
                      },
                    },
                    videos: true,
                  },
                },
                clips: {
                  orderBy: asc(clips.order),
                  ...(opts?.withArchived
                    ? {}
                    : { where: eq(clips.archived, false) }),
                },
                clipSections: {
                  orderBy: asc(clipSections.order),
                  ...(opts?.withArchived
                    ? {}
                    : { where: eq(clipSections.archived, false) }),
                },
              },
            })
          );

          if (!video) {
            return yield* new NotFoundError({
              type: "getVideoWithClipsById",
              params: { id },
            });
          }

          return video;
        }
      );

      const getRepoWithSectionsById = Effect.fn("getRepoWithSectionsById")(
        function* (id: string) {
          const repo = yield* makeDbCall(() =>
            db.query.repos.findFirst({
              where: eq(repos.id, id),
              with: {
                versions: {
                  orderBy: desc(repoVersions.createdAt),
                  with: {
                    sections: {
                      with: {
                        lessons: {
                          with: {
                            videos: {
                              orderBy: asc(videos.path),
                              with: {
                                clips: {
                                  orderBy: asc(clips.order),
                                  where: eq(clips.archived, false),
                                },
                              },
                            },
                          },
                          orderBy: asc(lessons.order),
                        },
                      },
                      orderBy: asc(sections.order),
                    },
                  },
                },
              },
            })
          );

          if (!repo) {
            return yield* new NotFoundError({
              type: "getRepoWithSections",
              params: { id },
            });
          }

          return repo;
        }
      );

      return {
        getClipById,
        getClipsByIds,
        updateClip,
        reorderClip,
        createClipSection,
        createClipSectionAtInsertionPoint,
        createClipSectionAtPosition,
        getClipSectionById,
        updateClipSection,
        archiveClipSection,
        reorderClipSection,
        getLessonById,
        getLessonWithHierarchyById,
        appendClips: Effect.fn("addClips")(function* (opts: {
          videoId: string;
          insertionPoint:
            | { type: "start" }
            | { type: "after-clip"; databaseClipId: string }
            | { type: "after-clip-section"; clipSectionId: string };
          clips: readonly {
            inputVideo: string;
            startTime: number;
            endTime: number;
          }[];
        }) {
          const { videoId, insertionPoint, clips: inputClips } = opts;
          let prevOrder: string | null | undefined = null;
          let nextOrder: string | null | undefined = null;

          // Get all non-archived clips and clip sections for this video
          const allClips = yield* makeDbCall(() =>
            db.query.clips.findMany({
              where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
              orderBy: asc(clips.order),
            })
          );

          const allClipSections = yield* makeDbCall(() =>
            db.query.clipSections.findMany({
              where: and(
                eq(clipSections.videoId, videoId),
                eq(clipSections.archived, false)
              ),
              orderBy: asc(clipSections.order),
            })
          );

          // Combine and sort by order to get correct insertion position
          const allItems = [
            ...allClips.map((c) => ({ type: "clip" as const, ...c })),
            ...allClipSections.map((cs) => ({
              type: "clip-section" as const,
              ...cs,
            })),
          ].sort((a, b) => compareOrderStrings(a.order, b.order));

          if (insertionPoint.type === "start") {
            // Insert before all items
            prevOrder = null;
            const firstItem = allItems[0];
            nextOrder = firstItem?.order;
          } else if (insertionPoint.type === "after-clip") {
            // Insert after specific clip, but before any section that follows it
            const insertAfterClipIndex = allItems.findIndex(
              (item) =>
                item.type === "clip" &&
                item.id === insertionPoint.databaseClipId
            );

            if (insertAfterClipIndex === -1) {
              return yield* new NotFoundError({
                type: "appendClips",
                params: { videoId, insertionPoint },
                message: `Could not find a clip to insert after`,
              });
            }

            const insertAfterItem = allItems[insertAfterClipIndex];
            prevOrder = insertAfterItem?.order;

            // Get the next item (could be a clip OR a section)
            const nextItem = allItems[insertAfterClipIndex + 1];
            nextOrder = nextItem?.order;
          } else if (insertionPoint.type === "after-clip-section") {
            // Insert after specific clip section
            const insertAfterSectionIndex = allItems.findIndex(
              (item) =>
                item.type === "clip-section" &&
                item.id === insertionPoint.clipSectionId
            );

            if (insertAfterSectionIndex === -1) {
              return yield* new NotFoundError({
                type: "appendClips",
                params: { videoId, insertionPoint },
                message: `Could not find a clip section to insert after`,
              });
            }

            const insertAfterItem = allItems[insertAfterSectionIndex];
            prevOrder = insertAfterItem?.order;

            const nextItem = allItems[insertAfterSectionIndex + 1];
            nextOrder = nextItem?.order;
          }

          const orders = generateNKeysBetween(
            prevOrder ?? null,
            nextOrder ?? null,
            inputClips.length
          );

          const clipsResult = yield* makeDbCall(() =>
            db
              .insert(clips)
              .values(
                inputClips.map((clip, index) => ({
                  ...clip,
                  videoId,
                  videoFilename: clip.inputVideo,
                  sourceStartTime: clip.startTime,
                  sourceEndTime: clip.endTime,
                  order: orders[index]!,
                  archived: false,
                  text: "",
                }))
              )
              .returning()
          );

          return clipsResult;
        }),
        createVideo: Effect.fn("createVideo")(function* (
          lessonId: string,
          video: {
            path: string;
            originalFootagePath: string;
          }
        ) {
          const videoResults = yield* makeDbCall(() =>
            db
              .insert(videos)
              .values({ ...video, lessonId })
              .returning()
          );

          const videoResult = videoResults[0];

          if (!videoResult) {
            return yield* new UnknownDBServiceError({
              cause: "No video was returned from the database",
            });
          }

          return videoResult;
        }),
        createStandaloneVideo: Effect.fn("createStandaloneVideo")(
          function* (video: { path: string }) {
            const videoResults = yield* makeDbCall(() =>
              db
                .insert(videos)
                .values({
                  path: video.path,
                  originalFootagePath: "",
                  lessonId: null,
                })
                .returning()
            );

            const videoResult = videoResults[0];

            if (!videoResult) {
              return yield* new UnknownDBServiceError({
                cause: "No video was returned from the database",
              });
            }

            return videoResult;
          }
        ),
        hasOriginalFootagePathAlreadyBeenUsed: Effect.fn(
          "hasOriginalFootagePathAlreadyBeenUsed"
        )(function* (originalFootagePath: string) {
          const foundVideo = yield* makeDbCall(() =>
            db.query.videos.findFirst({
              where: eq(videos.originalFootagePath, originalFootagePath),
            })
          );

          return !!foundVideo;
        }),
        updateVideo: Effect.fn("updateVideo")(function* (
          videoId: string,
          video: {
            originalFootagePath: string;
          }
        ) {
          const videoResult = yield* makeDbCall(() =>
            db.update(videos).set(video).where(eq(videos.id, videoId))
          );

          return videoResult;
        }),
        deleteVideo: Effect.fn("deleteVideo")(function* (videoId: string) {
          const videoResult = yield* makeDbCall(() =>
            db.delete(videos).where(eq(videos.id, videoId))
          );

          return videoResult;
        }),
        updateVideoPath: Effect.fn("updateVideoPath")(function* (opts: {
          videoId: string;
          path: string;
        }) {
          yield* makeDbCall(() =>
            db
              .update(videos)
              .set({ path: opts.path })
              .where(eq(videos.id, opts.videoId))
          );
        }),
        getRepoById,
        getRepoByFilePath,
        getRepoWithSectionsById,
        getRepoWithSectionsByFilePath: Effect.fn(
          "getRepoWithSectionsByFilePath"
        )(function* (filePath: string) {
          const repo = yield* getRepoByFilePath(filePath);

          return yield* getRepoWithSectionsById(repo.id);
        }),
        getRepos: Effect.fn("getRepos")(function* () {
          const reposResult = yield* makeDbCall(() =>
            db.query.repos.findMany({
              where: eq(repos.archived, false),
            })
          );
          return reposResult;
        }),
        getArchivedRepos: Effect.fn("getArchivedRepos")(function* () {
          const reposResult = yield* makeDbCall(() =>
            db.query.repos.findMany({
              where: eq(repos.archived, true),
            })
          );
          return reposResult;
        }),
        archiveClip,
        getVideoById: getVideoDeepById,
        getVideoWithClipsById: getVideoWithClipsById,
        getStandaloneVideos,
        getArchivedStandaloneVideos,
        createRepo: Effect.fn("createRepo")(function* (input: {
          filePath: string;
          name: string;
        }) {
          const reposResult = yield* makeDbCall(() =>
            db.insert(repos).values(input).returning()
          );

          const repo = reposResult[0];

          if (!repo) {
            return yield* new UnknownDBServiceError({
              cause: "No repo was returned from the database",
            });
          }

          return repo;
        }),
        createSections: Effect.fn("createSections")(function* ({
          sections: newSections,
          repoVersionId,
        }: {
          sections: {
            sectionPathWithNumber: string;
            sectionNumber: number;
          }[];
          repoVersionId: string;
        }) {
          const sectionResult = yield* makeDbCall(() =>
            db
              .insert(sections)
              .values(
                newSections.map((section) => ({
                  repoVersionId,
                  path: section.sectionPathWithNumber,
                  order: section.sectionNumber,
                }))
              )
              .returning()
          );

          return sectionResult;
        }),

        createLessons: Effect.fn("createLessons")(function* (
          sectionId: string,
          newLessons: {
            lessonPathWithNumber: string;
            lessonNumber: number;
          }[]
        ) {
          const lessonResult = yield* makeDbCall(() =>
            db
              .insert(lessons)
              .values(
                newLessons.map((lesson) => ({
                  sectionId,
                  path: lesson.lessonPathWithNumber,
                  order: lesson.lessonNumber,
                }))
              )
              .returning()
          );

          return lessonResult;
        }),
        updateLesson: Effect.fn("updateLesson")(function* (
          lessonId: string,
          lesson: {
            path?: string;
            sectionId?: string;
            lessonNumber?: number;
          }
        ) {
          const lessonResult = yield* makeDbCall(() =>
            db
              .update(lessons)
              .set({
                path: lesson.path,
                sectionId: lesson.sectionId,
                order: lesson.lessonNumber,
              })
              .where(eq(lessons.id, lessonId))
          );

          return lessonResult;
        }),
        deleteLesson: Effect.fn("deleteLesson")(function* (lessonId: string) {
          const lessonResult = yield* makeDbCall(() =>
            db.delete(lessons).where(eq(lessons.id, lessonId))
          );

          return lessonResult;
        }),
        deleteSection: Effect.fn("deleteSection")(function* (
          sectionId: string
        ) {
          const sectionResult = yield* makeDbCall(() =>
            db.delete(sections).where(eq(sections.id, sectionId))
          );

          return sectionResult;
        }),
        getNextVideoId: Effect.fn("getNextVideoId")(function* (
          currentVideoId: string
        ) {
          const currentVideo = yield* getVideoWithClipsById(currentVideoId);
          const currentLesson = currentVideo.lesson;
          if (!currentLesson) return null; // Standalone videos have no next/prev
          const currentSection = currentLesson.section;
          const repo = currentSection.repoVersion.repo;

          // Get all videos in current lesson sorted by path
          const videosInLesson = currentLesson.videos.sort(
            (a: { path: string }, b: { path: string }) =>
              a.path.localeCompare(b.path)
          );
          const currentVideoIndex = videosInLesson.findIndex(
            (v: { id: string }) => v.id === currentVideoId
          );

          // Try next video in current lesson
          if (currentVideoIndex < videosInLesson.length - 1) {
            return videosInLesson[currentVideoIndex + 1]?.id ?? null;
          }

          // Need to get all sections and lessons to find next
          const repoWithVersions = yield* getRepoWithSectionsById(repo.id);
          const latestVersionSections =
            repoWithVersions.versions[0]?.sections ?? [];

          // Find current lesson in the structure
          for (let sIdx = 0; sIdx < latestVersionSections.length; sIdx++) {
            const section = latestVersionSections[sIdx]!;
            for (let lIdx = 0; lIdx < section.lessons.length; lIdx++) {
              const lesson = section.lessons[lIdx]!;
              if (lesson.id === currentLesson.id) {
                // Try next lesson in current section
                if (lIdx < section.lessons.length - 1) {
                  const nextLesson = section.lessons[lIdx + 1]!;
                  const firstVideo = nextLesson.videos.sort(
                    (a: { path: string }, b: { path: string }) =>
                      a.path.localeCompare(b.path)
                  )[0];
                  return firstVideo?.id ?? null;
                }

                // Try first lesson of next section
                if (sIdx < latestVersionSections.length - 1) {
                  const nextSection = latestVersionSections[sIdx + 1]!;
                  const firstLesson = nextSection.lessons[0];
                  const firstVideo = firstLesson?.videos.sort(
                    (a: { path: string }, b: { path: string }) =>
                      a.path.localeCompare(b.path)
                  )[0];
                  return firstVideo?.id ?? null;
                }

                // No more videos
                return null;
              }
            }
          }

          return null;
        }),
        getPreviousVideoId: Effect.fn("getPreviousVideoId")(function* (
          currentVideoId: string
        ) {
          const currentVideo = yield* getVideoWithClipsById(currentVideoId);
          const currentLesson = currentVideo.lesson;
          if (!currentLesson) return null; // Standalone videos have no next/prev
          const currentSection = currentLesson.section;
          const repo = currentSection.repoVersion.repo;

          // Get all videos in current lesson sorted by path
          const videosInLesson = currentLesson.videos.sort(
            (a: { path: string }, b: { path: string }) =>
              a.path.localeCompare(b.path)
          );
          const currentVideoIndex = videosInLesson.findIndex(
            (v: { id: string }) => v.id === currentVideoId
          );

          // Try previous video in current lesson
          if (currentVideoIndex > 0) {
            return videosInLesson[currentVideoIndex - 1]?.id ?? null;
          }

          // Need to get all sections and lessons to find previous
          const repoWithVersions = yield* getRepoWithSectionsById(repo.id);
          const latestVersionSections =
            repoWithVersions.versions[0]?.sections ?? [];

          // Find current lesson in the structure
          for (let sIdx = 0; sIdx < latestVersionSections.length; sIdx++) {
            const section = latestVersionSections[sIdx]!;
            for (let lIdx = 0; lIdx < section.lessons.length; lIdx++) {
              const lesson = section.lessons[lIdx]!;
              if (lesson.id === currentLesson.id) {
                // Try previous lesson in current section
                if (lIdx > 0) {
                  const prevLesson = section.lessons[lIdx - 1]!;
                  const videos = prevLesson.videos.sort(
                    (a: { path: string }, b: { path: string }) =>
                      a.path.localeCompare(b.path)
                  );
                  const lastVideo = videos[videos.length - 1];
                  return lastVideo?.id ?? null;
                }

                // Try last lesson of previous section
                if (sIdx > 0) {
                  const prevSection = latestVersionSections[sIdx - 1]!;
                  const lastLesson =
                    prevSection.lessons[prevSection.lessons.length - 1];
                  const videos = lastLesson?.videos.sort(
                    (a: { path: string }, b: { path: string }) =>
                      a.path.localeCompare(b.path)
                  );
                  const lastVideo = videos?.[videos.length - 1];
                  return lastVideo?.id ?? null;
                }

                // No more videos
                return null;
              }
            }
          }

          return null;
        }),
        /**
         * Gets the next lesson that has no videos, starting from the current video's lesson.
         * Returns lesson info if found, null if no such lesson exists.
         */
        getNextLessonWithoutVideo: Effect.fn("getNextLessonWithoutVideo")(
          function* (currentVideoId: string) {
            const currentVideo = yield* getVideoWithClipsById(currentVideoId);
            const currentLesson = currentVideo.lesson;
            if (!currentLesson) return null; // Standalone videos have no next/prev

            const currentSection = currentLesson.section;
            const repo = currentSection.repoVersion.repo;

            // Need to get all sections and lessons to find next lesson without video
            const repoWithVersions = yield* getRepoWithSectionsById(repo.id);
            const latestVersionSections =
              repoWithVersions.versions[0]?.sections ?? [];

            // Find current lesson in the structure
            for (let sIdx = 0; sIdx < latestVersionSections.length; sIdx++) {
              const section = latestVersionSections[sIdx]!;
              for (let lIdx = 0; lIdx < section.lessons.length; lIdx++) {
                const lesson = section.lessons[lIdx]!;
                if (lesson.id === currentLesson.id) {
                  // Search for next lesson with no videos, starting from next lesson
                  // First check remaining lessons in current section
                  for (
                    let nextLIdx = lIdx + 1;
                    nextLIdx < section.lessons.length;
                    nextLIdx++
                  ) {
                    const nextLesson = section.lessons[nextLIdx]!;
                    if (nextLesson.videos.length === 0) {
                      return {
                        lessonId: nextLesson.id,
                        lessonPath: nextLesson.path,
                        sectionPath: section.path,
                        repoFilePath: repo.filePath,
                      };
                    }
                  }

                  // Then check lessons in subsequent sections
                  for (
                    let nextSIdx = sIdx + 1;
                    nextSIdx < latestVersionSections.length;
                    nextSIdx++
                  ) {
                    const nextSection = latestVersionSections[nextSIdx]!;
                    for (const nextLesson of nextSection.lessons) {
                      if (nextLesson.videos.length === 0) {
                        return {
                          lessonId: nextLesson.id,
                          lessonPath: nextLesson.path,
                          sectionPath: nextSection.path,
                          repoFilePath: repo.filePath,
                        };
                      }
                    }
                  }

                  // No lesson without video found
                  return null;
                }
              }
            }

            return null;
          }
        ),
        // Version-related methods
        getRepoVersions: Effect.fn("getRepoVersions")(function* (
          repoId: string
        ) {
          const versions = yield* makeDbCall(() =>
            db.query.repoVersions.findMany({
              where: eq(repoVersions.repoId, repoId),
              orderBy: desc(repoVersions.createdAt),
            })
          );
          return versions;
        }),
        getLatestRepoVersion: Effect.fn("getLatestRepoVersion")(function* (
          repoId: string
        ) {
          const version = yield* makeDbCall(() =>
            db.query.repoVersions.findFirst({
              where: eq(repoVersions.repoId, repoId),
              orderBy: desc(repoVersions.createdAt),
            })
          );
          return version;
        }),
        getRepoVersionById: Effect.fn("getRepoVersionById")(function* (
          versionId: string
        ) {
          const version = yield* makeDbCall(() =>
            db.query.repoVersions.findFirst({
              where: eq(repoVersions.id, versionId),
            })
          );

          if (!version) {
            return yield* new NotFoundError({
              type: "getRepoVersionById",
              params: { versionId },
            });
          }

          return version;
        }),
        getRepoWithSectionsByVersion: Effect.fn("getRepoWithSectionsByVersion")(
          function* (opts: { repoId: string; versionId: string }) {
            const { repoId, versionId } = opts;
            const repo = yield* makeDbCall(() =>
              db.query.repos.findFirst({
                where: eq(repos.id, repoId),
              })
            );

            if (!repo) {
              return yield* new NotFoundError({
                type: "getRepoWithSectionsByVersion",
                params: { repoId, versionId },
              });
            }

            const versionSections = yield* makeDbCall(() =>
              db.query.sections.findMany({
                where: eq(sections.repoVersionId, versionId),
                orderBy: asc(sections.order),
                with: {
                  lessons: {
                    orderBy: asc(lessons.order),
                    with: {
                      videos: {
                        orderBy: asc(videos.path),
                        with: {
                          clips: {
                            orderBy: asc(clips.order),
                            where: eq(clips.archived, false),
                          },
                        },
                      },
                    },
                  },
                },
              })
            );

            return {
              ...repo,
              sections: versionSections,
            };
          }
        ),
        getVersionWithSections: Effect.fn("getVersionWithSections")(function* (
          versionId: string
        ) {
          const version = yield* makeDbCall(() =>
            db.query.repoVersions.findFirst({
              where: eq(repoVersions.id, versionId),
              with: {
                repo: true,
                sections: {
                  orderBy: asc(sections.order),
                  with: {
                    lessons: {
                      orderBy: asc(lessons.order),
                      with: {
                        videos: {
                          orderBy: asc(videos.path),
                          with: {
                            clips: {
                              orderBy: asc(clips.order),
                              where: eq(clips.archived, false),
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            })
          );

          if (!version) {
            return yield* new NotFoundError({
              type: "getVersionWithSections",
              params: { versionId },
            });
          }

          return version;
        }),
        createRepoVersion: Effect.fn("createRepoVersion")(function* (input: {
          repoId: string;
          name: string;
        }) {
          const [version] = yield* makeDbCall(() =>
            db.insert(repoVersions).values(input).returning()
          );

          if (!version) {
            return yield* new UnknownDBServiceError({
              cause: "No version was returned from the database",
            });
          }

          return version;
        }),
        updateRepoVersionName: Effect.fn("updateRepoVersionName")(
          function* (opts: { versionId: string; name: string }) {
            const { versionId, name } = opts;
            const [updated] = yield* makeDbCall(() =>
              db
                .update(repoVersions)
                .set({ name })
                .where(eq(repoVersions.id, versionId))
                .returning()
            );

            if (!updated) {
              return yield* new NotFoundError({
                type: "updateRepoVersionName",
                params: { versionId },
              });
            }

            return updated;
          }
        ),
        updateRepoName: Effect.fn("updateRepoName")(function* (opts: {
          repoId: string;
          name: string;
        }) {
          const { repoId, name } = opts;
          const [updated] = yield* makeDbCall(() =>
            db
              .update(repos)
              .set({ name })
              .where(eq(repos.id, repoId))
              .returning()
          );

          if (!updated) {
            return yield* new NotFoundError({
              type: "updateRepoName",
              params: { repoId },
            });
          }

          return updated;
        }),
        updateRepoArchiveStatus: Effect.fn("updateRepoArchiveStatus")(
          function* (opts: { repoId: string; archived: boolean }) {
            const { repoId, archived } = opts;
            const [updated] = yield* makeDbCall(() =>
              db
                .update(repos)
                .set({ archived })
                .where(eq(repos.id, repoId))
                .returning()
            );

            if (!updated) {
              return yield* new NotFoundError({
                type: "updateRepoArchiveStatus",
                params: { repoId },
              });
            }

            return updated;
          }
        ),
        updateVideoArchiveStatus: Effect.fn("updateVideoArchiveStatus")(
          function* (opts: { videoId: string; archived: boolean }) {
            const { videoId, archived } = opts;

            // First verify the video is a standalone video (lessonId is NULL)
            const video = yield* makeDbCall(() =>
              db.query.videos.findFirst({
                where: eq(videos.id, videoId),
              })
            );

            if (!video) {
              return yield* new NotFoundError({
                type: "updateVideoArchiveStatus",
                params: { videoId },
              });
            }

            if (video.lessonId !== null) {
              return yield* new CannotArchiveLessonVideoError({
                videoId,
                lessonId: video.lessonId,
              });
            }

            const [updated] = yield* makeDbCall(() =>
              db
                .update(videos)
                .set({ archived })
                .where(eq(videos.id, videoId))
                .returning()
            );

            if (!updated) {
              return yield* new NotFoundError({
                type: "updateVideoArchiveStatus",
                params: { videoId },
              });
            }

            return updated;
          }
        ),
        updateRepoFilePath: Effect.fn("updateRepoFilePath")(function* (opts: {
          repoId: string;
          filePath: string;
        }) {
          const { repoId, filePath } = opts;

          // Check if multiple repos share the current repo's path
          const currentRepo = yield* makeDbCall(() =>
            db.query.repos.findFirst({
              where: eq(repos.id, repoId),
            })
          );

          if (!currentRepo) {
            return yield* new NotFoundError({
              type: "updateRepoFilePath",
              params: { repoId },
            });
          }

          const reposWithSamePath = yield* makeDbCall(() =>
            db.query.repos.findMany({
              where: eq(repos.filePath, currentRepo.filePath),
            })
          );

          if (reposWithSamePath.length > 1) {
            return yield* new AmbiguousRepoUpdateError({
              filePath: currentRepo.filePath,
              repoCount: reposWithSamePath.length,
            });
          }

          const [updated] = yield* makeDbCall(() =>
            db
              .update(repos)
              .set({ filePath })
              .where(eq(repos.id, repoId))
              .returning()
          );

          if (!updated) {
            return yield* new NotFoundError({
              type: "updateRepoFilePath",
              params: { repoId },
            });
          }

          return updated;
        }),
        deleteRepo: Effect.fn("deleteRepo")(function* (repoId: string) {
          yield* makeDbCall(() => db.delete(repos).where(eq(repos.id, repoId)));
        }),
        /**
         * Delete a repo version. Only the latest version can be deleted,
         * and a repo must have at least one version remaining.
         */
        deleteRepoVersion: Effect.fn("deleteRepoVersion")(function* (
          versionId: string
        ) {
          // Get the version to find its repoId
          const version = yield* makeDbCall(() =>
            db.query.repoVersions.findFirst({
              where: eq(repoVersions.id, versionId),
            })
          );

          if (!version) {
            return yield* new NotFoundError({
              type: "deleteRepoVersion",
              params: { versionId },
            });
          }

          // Get all versions for this repo
          const allVersions = yield* makeDbCall(() =>
            db.query.repoVersions.findMany({
              where: eq(repoVersions.repoId, version.repoId),
              orderBy: desc(repoVersions.createdAt),
            })
          );

          // Cannot delete the only version
          if (allVersions.length <= 1) {
            return yield* new CannotDeleteOnlyVersionError({
              versionId,
              repoId: version.repoId,
            });
          }

          // Can only delete the latest version
          const latestVersion = allVersions[0];
          if (!latestVersion || latestVersion.id !== versionId) {
            return yield* new CannotDeleteNonLatestVersionError({
              versionId,
              latestVersionId: latestVersion?.id ?? "none",
            });
          }

          // Delete the version (cascades to sections, lessons, videos, clips)
          yield* makeDbCall(() =>
            db.delete(repoVersions).where(eq(repoVersions.id, versionId))
          );

          // Return the new latest version (second in the original list)
          const newLatestVersion = allVersions[1];
          return newLatestVersion;
        }),
        /**
         * Copy structure from an existing version to a new version.
         * Copies all sections, lessons, videos, and non-archived clips.
         * Sets previousVersionSectionId and previousVersionLessonId for change tracking.
         */
        copyVersionStructure: Effect.fn("copyVersionStructure")(
          function* (input: {
            sourceVersionId: string;
            repoId: string;
            newVersionName: string;
          }) {
            // Verify sourceVersionId is the latest version for this repo
            const latestVersion = yield* makeDbCall(() =>
              db.query.repoVersions.findFirst({
                where: eq(repoVersions.repoId, input.repoId),
                orderBy: desc(repoVersions.createdAt),
              })
            );

            if (!latestVersion || latestVersion.id !== input.sourceVersionId) {
              return yield* new NotLatestVersionError({
                sourceVersionId: input.sourceVersionId,
                latestVersionId: latestVersion?.id ?? "none",
              });
            }

            // Create the new version
            const newVersion = yield* makeDbCall(() =>
              db
                .insert(repoVersions)
                .values({
                  repoId: input.repoId,
                  name: input.newVersionName,
                })
                .returning()
            ).pipe(
              Effect.andThen((arr) => {
                const v = arr[0];
                if (!v) {
                  return Effect.fail(
                    new UnknownDBServiceError({ cause: "No version returned" })
                  );
                }
                return Effect.succeed(v);
              })
            );

            // Get all sections for the source version with their lessons, videos, and clips
            const sourceSections = yield* makeDbCall(() =>
              db.query.sections.findMany({
                where: eq(sections.repoVersionId, input.sourceVersionId),
                orderBy: asc(sections.order),
                with: {
                  lessons: {
                    orderBy: asc(lessons.order),
                    with: {
                      videos: {
                        orderBy: asc(videos.path),
                        with: {
                          clips: {
                            orderBy: asc(clips.order),
                            where: eq(clips.archived, false), // Only non-archived clips
                          },
                        },
                      },
                    },
                  },
                },
              })
            );

            // Track video ID mappings: sourceVideoId -> newVideoId
            const videoIdMappings: Array<{
              sourceVideoId: string;
              newVideoId: string;
            }> = [];

            // Copy each section
            for (const sourceSection of sourceSections) {
              const [newSection] = yield* makeDbCall(() =>
                db
                  .insert(sections)
                  .values({
                    repoVersionId: newVersion.id,
                    previousVersionSectionId: sourceSection.id,
                    path: sourceSection.path,
                    order: sourceSection.order,
                  })
                  .returning()
              );

              if (!newSection) continue;

              // Copy each lesson in the section
              for (const sourceLesson of sourceSection.lessons) {
                const [newLesson] = yield* makeDbCall(() =>
                  db
                    .insert(lessons)
                    .values({
                      sectionId: newSection.id,
                      previousVersionLessonId: sourceLesson.id,
                      path: sourceLesson.path,
                      order: sourceLesson.order,
                    })
                    .returning()
                );

                if (!newLesson) continue;

                // Copy each video in the lesson
                for (const sourceVideo of sourceLesson.videos) {
                  const [newVideo] = yield* makeDbCall(() =>
                    db
                      .insert(videos)
                      .values({
                        lessonId: newLesson.id,
                        path: sourceVideo.path,
                        originalFootagePath: sourceVideo.originalFootagePath,
                      })
                      .returning()
                  );

                  if (!newVideo) continue;

                  // Track the video ID mapping
                  videoIdMappings.push({
                    sourceVideoId: sourceVideo.id,
                    newVideoId: newVideo.id,
                  });

                  // Copy each non-archived clip in the video
                  if (sourceVideo.clips.length > 0) {
                    yield* makeDbCall(() =>
                      db.insert(clips).values(
                        sourceVideo.clips.map((clip) => ({
                          videoId: newVideo.id,
                          videoFilename: clip.videoFilename,
                          sourceStartTime: clip.sourceStartTime,
                          sourceEndTime: clip.sourceEndTime,
                          order: clip.order,
                          archived: false,
                          text: clip.text,
                          transcribedAt: clip.transcribedAt,
                          scene: clip.scene,
                          profile: clip.profile,
                          beatType: clip.beatType,
                        }))
                      )
                    );
                  }
                }
              }
            }

            return { version: newVersion, videoIdMappings };
          }
        ),
        /**
         * Get all video IDs for a specific version.
         */
        getVideoIdsForVersion: Effect.fn("getVideoIdsForVersion")(function* (
          versionId: string
        ) {
          const versionSections = yield* makeDbCall(() =>
            db.query.sections.findMany({
              where: eq(sections.repoVersionId, versionId),
              with: {
                lessons: {
                  with: {
                    videos: {
                      columns: {
                        id: true,
                      },
                    },
                  },
                },
              },
            })
          );

          const videoIds: string[] = [];
          for (const section of versionSections) {
            for (const lesson of section.lessons) {
              for (const video of lesson.videos) {
                videoIds.push(video.id);
              }
            }
          }

          return videoIds;
        }),
        /**
         * Get all versions for a repo with their full structure for changelog generation.
         * Returns versions in reverse chronological order (newest first).
         */
        getAllVersionsWithStructure: Effect.fn("getAllVersionsWithStructure")(
          function* (repoId: string) {
            const versions = yield* makeDbCall(() =>
              db.query.repoVersions.findMany({
                where: eq(repoVersions.repoId, repoId),
                orderBy: desc(repoVersions.createdAt),
              })
            );

            const versionsWithStructure: Array<{
              id: string;
              name: string;
              createdAt: Date;
              sections: Array<{
                id: string;
                path: string;
                previousVersionSectionId: string | null;
                lessons: Array<{
                  id: string;
                  path: string;
                  previousVersionLessonId: string | null;
                  videos: Array<{
                    id: string;
                    path: string;
                    clips: Array<{
                      id: string;
                      text: string;
                    }>;
                  }>;
                }>;
              }>;
            }> = [];

            for (const version of versions) {
              const versionSections = yield* makeDbCall(() =>
                db.query.sections.findMany({
                  where: eq(sections.repoVersionId, version.id),
                  orderBy: asc(sections.order),
                  with: {
                    lessons: {
                      orderBy: asc(lessons.order),
                      with: {
                        videos: {
                          orderBy: asc(videos.path),
                          with: {
                            clips: {
                              orderBy: asc(clips.order),
                              where: eq(clips.archived, false),
                            },
                          },
                        },
                      },
                    },
                  },
                })
              );

              versionsWithStructure.push({
                id: version.id,
                name: version.name,
                createdAt: version.createdAt,
                sections: versionSections.map((s) => ({
                  id: s.id,
                  path: s.path,
                  previousVersionSectionId: s.previousVersionSectionId,
                  lessons: s.lessons.map((l) => ({
                    id: l.id,
                    path: l.path,
                    previousVersionLessonId: l.previousVersionLessonId,
                    videos: l.videos.map((v) => ({
                      id: v.id,
                      path: v.path,
                      clips: v.clips.map((c) => ({
                        id: c.id,
                        text: c.text,
                      })),
                    })),
                  })),
                })),
              });
            }

            return versionsWithStructure;
          }
        ),
        // Plan-related methods
        getPlans: Effect.fn("getPlans")(function* () {
          const allPlans = yield* makeDbCall(() =>
            db.query.plans.findMany({
              orderBy: desc(plans.createdAt),
              with: {
                sections: {
                  orderBy: asc(planSections.order),
                  with: {
                    lessons: {
                      orderBy: asc(planLessons.order),
                    },
                  },
                },
              },
            })
          );

          // Transform to match the Plan type expected by the frontend
          return allPlans.map((plan) => ({
            id: plan.id,
            title: plan.title,
            createdAt: plan.createdAt.toISOString(),
            updatedAt: plan.updatedAt.toISOString(),
            sections: plan.sections.map((section) => ({
              id: section.id,
              title: section.title,
              order: section.order,
              lessons: section.lessons.map((lesson) => ({
                id: lesson.id,
                title: lesson.title,
                order: lesson.order,
                description: lesson.description,
                icon: lesson.icon as
                  | "watch"
                  | "code"
                  | "discussion"
                  | undefined,
                status: lesson.status as "todo" | "done" | "maybe" | undefined,
                priority: lesson.priority as 1 | 2 | 3 | undefined,
                dependencies: lesson.dependencies ?? undefined,
              })),
            })),
          }));
        }),
        /**
         * Sync a single plan - deletes the existing plan with given ID and inserts the new one.
         * This is a simple "last write wins" approach for single-user app.
         */
        syncPlan: Effect.fn("syncPlan")(function* (plan: {
          readonly id: string;
          readonly title: string;
          readonly createdAt: string;
          readonly updatedAt: string;
          readonly sections: readonly {
            readonly id: string;
            readonly title: string;
            readonly order: number;
            readonly lessons: readonly {
              readonly id: string;
              readonly title: string;
              readonly order: number;
              readonly description?: string;
              readonly icon?: "watch" | "code" | "discussion" | null;
              readonly status?: "todo" | "done" | "maybe" | null;
              readonly priority?: 1 | 2 | 3 | null;
              readonly dependencies?: readonly string[];
            }[];
          }[];
        }) {
          // Delete the existing plan with this ID (cascades to sections and lessons)
          yield* makeDbCall(() =>
            db.delete(plans).where(eq(plans.id, plan.id))
          );

          // Insert the plan
          yield* makeDbCall(() =>
            db.insert(plans).values({
              id: plan.id,
              title: plan.title,
              createdAt: new Date(plan.createdAt),
              updatedAt: new Date(plan.updatedAt),
            })
          );

          // Insert sections for this plan
          for (const section of plan.sections) {
            yield* makeDbCall(() =>
              db.insert(planSections).values({
                id: section.id,
                planId: plan.id,
                title: section.title,
                order: section.order,
              })
            );

            // Insert lessons for this section
            if (section.lessons.length > 0) {
              yield* makeDbCall(() =>
                db.insert(planLessons).values(
                  section.lessons.map((lesson) => ({
                    id: lesson.id,
                    sectionId: section.id,
                    title: lesson.title,
                    order: lesson.order,
                    description: lesson.description,
                    icon: lesson.icon ?? null,
                    status: lesson.status ?? "todo",
                    priority: lesson.priority ?? 2,
                    dependencies: lesson.dependencies
                      ? [...lesson.dependencies]
                      : null,
                  }))
                )
              );
            }
          }

          return { success: true };
        }),
        /**
         * Delete a plan by ID. Sections and lessons are cascade deleted.
         */
        deletePlan: Effect.fn("deletePlan")(function* (planId: string) {
          yield* makeDbCall(() => db.delete(plans).where(eq(plans.id, planId)));
          return { success: true };
        }),
        /**
         * Rename a plan by ID.
         */
        renamePlan: Effect.fn("renamePlan")(function* (
          planId: string,
          newTitle: string
        ) {
          yield* makeDbCall(() =>
            db
              .update(plans)
              .set({ title: newTitle, updatedAt: new Date() })
              .where(eq(plans.id, planId))
          );
          return { success: true };
        }),
        // Link-related methods for global link management
        /**
         * Get all links ordered by creation date (newest first).
         */
        getLinks: Effect.fn("getLinks")(function* () {
          const allLinks = yield* makeDbCall(() =>
            db.query.links.findMany({
              orderBy: desc(links.createdAt),
            })
          );
          return allLinks;
        }),
        /**
         * Create a new link.
         */
        createLink: Effect.fn("createLink")(function* (link: {
          title: string;
          url: string;
          description?: string | null;
        }) {
          const [newLink] = yield* makeDbCall(() =>
            db
              .insert(links)
              .values({
                title: link.title,
                url: link.url,
                description: link.description ?? null,
              })
              .returning()
          );

          if (!newLink) {
            return yield* new UnknownDBServiceError({
              cause: "No link was returned from the database",
            });
          }

          return newLink;
        }),
        /**
         * Delete a link by ID.
         */
        deleteLink: Effect.fn("deleteLink")(function* (linkId: string) {
          yield* makeDbCall(() => db.delete(links).where(eq(links.id, linkId)));
          return { success: true };
        }),
        /**
         * Get the 3 most recent videos (by createdAt) that have 10+ unarchived clips.
         * Used for generating dynamic few-shot examples for next-clip suggestions.
         * Excludes the current video being edited.
         */
        getVideosForFewShotExamples: Effect.fn("getVideosForFewShotExamples")(
          function* (excludeVideoId?: string) {
            // Get all non-archived videos with their non-archived clips
            const allVideos = yield* makeDbCall(() =>
              db.query.videos.findMany({
                where: eq(videos.archived, false),
                orderBy: desc(videos.createdAt),
                with: {
                  clips: {
                    orderBy: asc(clips.order),
                    where: eq(clips.archived, false),
                  },
                },
              })
            );

            // Filter to videos with 10+ clips, excluding the current video
            const eligibleVideos = allVideos
              .filter(
                (video) =>
                  video.clips.length >= 10 &&
                  (excludeVideoId === undefined || video.id !== excludeVideoId)
              )
              .slice(0, 3);

            return eligibleVideos;
          }
        ),
        // YouTube OAuth token methods
        /**
         * Get the current YouTube auth tokens (single-user design).
         * Returns null if not authenticated.
         */
        getYoutubeAuth: Effect.fn("getYoutubeAuth")(function* () {
          const auth = yield* makeDbCall(() =>
            db.query.youtubeAuth.findFirst()
          );
          return auth ?? null;
        }),
        /**
         * Upsert YouTube auth tokens. Deletes any existing tokens and inserts new ones.
         * Single-user design: only one set of tokens is stored at a time.
         */
        upsertYoutubeAuth: Effect.fn("upsertYoutubeAuth")(function* (tokens: {
          accessToken: string;
          refreshToken: string;
          expiresAt: Date;
        }) {
          // Delete any existing tokens
          yield* makeDbCall(() => db.delete(youtubeAuth));

          // Insert new tokens
          const [newAuth] = yield* makeDbCall(() =>
            db
              .insert(youtubeAuth)
              .values({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt,
              })
              .returning()
          );

          if (!newAuth) {
            return yield* new UnknownDBServiceError({
              cause: "No YouTube auth was returned from the database",
            });
          }

          return newAuth;
        }),
        /**
         * Update the access token and expiry (after refresh).
         */
        updateYoutubeAccessToken: Effect.fn("updateYoutubeAccessToken")(
          function* (tokens: { accessToken: string; expiresAt: Date }) {
            const existing = yield* makeDbCall(() =>
              db.query.youtubeAuth.findFirst()
            );

            if (!existing) {
              return yield* new NotFoundError({
                type: "updateYoutubeAccessToken",
                params: {},
                message: "No YouTube auth found to update",
              });
            }

            const [updated] = yield* makeDbCall(() =>
              db
                .update(youtubeAuth)
                .set({
                  accessToken: tokens.accessToken,
                  expiresAt: tokens.expiresAt,
                  updatedAt: new Date(),
                })
                .where(eq(youtubeAuth.id, existing.id))
                .returning()
            );

            if (!updated) {
              return yield* new NotFoundError({
                type: "updateYoutubeAccessToken",
                params: {},
              });
            }

            return updated;
          }
        ),
        /**
         * Delete YouTube auth tokens (disconnect account).
         */
        deleteYoutubeAuth: Effect.fn("deleteYoutubeAuth")(function* () {
          yield* makeDbCall(() => db.delete(youtubeAuth));
          return { success: true };
        }),
        getThumbnailsByVideoId: Effect.fn("getThumbnailsByVideoId")(function* (
          videoId: string
        ) {
          return yield* makeDbCall(() =>
            db.query.thumbnails.findMany({
              where: eq(thumbnails.videoId, videoId),
              orderBy: desc(thumbnails.createdAt),
            })
          );
        }),
        createThumbnail: Effect.fn("createThumbnail")(function* (params: {
          videoId: string;
          layers: unknown;
          filePath: string | null;
        }) {
          const [record] = yield* makeDbCall(() =>
            db
              .insert(thumbnails)
              .values({
                videoId: params.videoId,
                layers: params.layers,
                filePath: params.filePath,
              })
              .returning()
          );
          if (!record) {
            return yield* Effect.die("Failed to create thumbnail");
          }
          return record;
        }),
        getThumbnailById: Effect.fn("getThumbnailById")(function* (
          thumbnailId: string
        ) {
          const thumbnail = yield* makeDbCall(() =>
            db.query.thumbnails.findFirst({
              where: eq(thumbnails.id, thumbnailId),
            })
          );

          if (!thumbnail) {
            return yield* new NotFoundError({
              type: "getThumbnailById",
              params: { thumbnailId },
            });
          }

          return thumbnail;
        }),
        updateThumbnail: Effect.fn("updateThumbnail")(function* (
          thumbnailId: string,
          params: {
            layers: unknown;
            filePath: string | null;
          }
        ) {
          const [updated] = yield* makeDbCall(() =>
            db
              .update(thumbnails)
              .set({
                layers: params.layers,
                filePath: params.filePath,
              })
              .where(eq(thumbnails.id, thumbnailId))
              .returning()
          );

          if (!updated) {
            return yield* new NotFoundError({
              type: "updateThumbnail",
              params: { thumbnailId },
            });
          }

          return updated;
        }),
        selectThumbnailForUpload: Effect.fn("selectThumbnailForUpload")(
          function* (thumbnailId: string, videoId: string) {
            // Deselect all thumbnails for this video
            yield* makeDbCall(() =>
              db
                .update(thumbnails)
                .set({ selectedForUpload: false })
                .where(eq(thumbnails.videoId, videoId))
            );
            // Select the chosen one
            const [updated] = yield* makeDbCall(() =>
              db
                .update(thumbnails)
                .set({ selectedForUpload: true })
                .where(eq(thumbnails.id, thumbnailId))
                .returning()
            );
            if (!updated) {
              return yield* new NotFoundError({
                type: "selectThumbnailForUpload",
                params: { thumbnailId },
              });
            }
            return updated;
          }
        ),
        deselectAllThumbnails: Effect.fn("deselectAllThumbnails")(function* (
          videoId: string
        ) {
          yield* makeDbCall(() =>
            db
              .update(thumbnails)
              .set({ selectedForUpload: false })
              .where(eq(thumbnails.videoId, videoId))
          );
        }),
        deleteThumbnail: Effect.fn("deleteThumbnail")(function* (
          thumbnailId: string
        ) {
          const [deleted] = yield* makeDbCall(() =>
            db
              .delete(thumbnails)
              .where(eq(thumbnails.id, thumbnailId))
              .returning()
          );

          if (!deleted) {
            return yield* new NotFoundError({
              type: "deleteThumbnail",
              params: { thumbnailId },
            });
          }

          return deleted;
        }),
      };
    }),
  }
) {}
