import { useEffect, useRef } from "react";
import type { DB } from "@/db/schema";
import type {
  ClipOnDatabase,
  ClipSectionOnDatabase,
  DatabaseId,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "@/features/video-editor/clip-state-reducer";
import {
  clipStateReducer,
  createFrontendId,
} from "@/features/video-editor/clip-state-reducer";
import type { BeatType } from "@/services/video-processing-service";
import { useOBSConnector } from "@/features/video-editor/obs-connector";
import { VideoEditor } from "@/features/video-editor/video-editor";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";
import { useEffectReducer } from "use-effect-reducer";
import type { Route } from "./+types/videos.$videoId.edit";
import {
  INSERTION_POINT_ID,
  RECORDING_SESSION_PANELS_ID,
} from "@/features/video-editor/constants";
import { data, useNavigate, useRevalidator } from "react-router";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { Array as EffectArray } from "effect";
import { sortByOrder } from "@/lib/sort-by-order";
import { createHttpClipService } from "@/services/clip-service";
import path from "node:path";
import {
  ALWAYS_EXCLUDED_DIRECTORIES,
  DEFAULT_CHECKED_EXTENSIONS,
  DEFAULT_UNCHECKED_PATHS,
} from "@/services/text-writing-agent";

export type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

// Core data model - flat array of clips

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const fs = yield* FileSystem.FileSystem;
    const video = yield* db.getVideoWithClipsById(videoId);

    // Check if lesson has explainer folder (only for lesson-attached videos)
    const lesson = video.lesson;
    const hasExplainerFolder = lesson
      ? yield* fs.exists(
          `${lesson.section.repoVersion.repo.filePath}/${lesson.section.path}/${lesson.path}/explainer`
        )
      : false;

    // Combine clips and clipSections into a unified items array, sorted by order
    const clipItems: Array<{ type: "clip"; order: string; data: DB.Clip }> = (
      video.clips as DB.Clip[]
    ).map((clip) => ({
      type: "clip" as const,
      order: clip.order,
      data: clip,
    }));

    const clipSectionItems: Array<{
      type: "clip-section";
      order: string;
      data: DB.ClipSection;
    }> = (video.clipSections as DB.ClipSection[]).map((clipSection) => ({
      type: "clip-section" as const,
      order: clipSection.order,
      data: clipSection,
    }));

    const sortedItems = sortByOrder([...clipItems, ...clipSectionItems]);

    // Get standalone video files directory
    const standaloneVideoDir = getStandaloneVideoFilePath(videoId);

    // Check if directory exists
    const dirExists = yield* fs.exists(standaloneVideoDir);

    let standaloneFiles: Array<{
      path: string;
    }> = [];

    if (dirExists) {
      // Read all files from the standalone video directory
      const filesInDirectory = yield* fs.readDirectory(standaloneVideoDir);

      standaloneFiles = yield* Effect.forEach(filesInDirectory, (filename) => {
        return Effect.gen(function* () {
          const filePath = getStandaloneVideoFilePath(videoId, filename);
          const stat = yield* fs.stat(filePath);

          if (stat.type !== "File") {
            return null;
          }

          return {
            path: filename,
          };
        });
      }).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
    }

    // Get code files for suggestions context
    let files: FileMetadata[] = [];

    if (lesson) {
      // For lesson-attached videos, get files from the lesson directory
      const repo = lesson.section.repoVersion.repo;
      const section = lesson.section;
      const lessonPath = path.join(repo.filePath, section.path, lesson.path);

      const allFilesInDirectory = yield* fs
        .readDirectory(lessonPath, { recursive: true })
        .pipe(
          Effect.map((filesResult) =>
            filesResult.map((file) => path.join(lessonPath, file))
          )
        );

      const filteredFiles = allFilesInDirectory.filter((filePath) => {
        return !ALWAYS_EXCLUDED_DIRECTORIES.some((excludedDir) =>
          filePath.includes(excludedDir)
        );
      });

      files = yield* Effect.forEach(filteredFiles, (filePath) => {
        return Effect.gen(function* () {
          const stat = yield* fs.stat(filePath);

          if (stat.type !== "File") {
            return null;
          }

          const relativePath = path.relative(lessonPath, filePath);
          const extension = path.extname(filePath).slice(1);

          const defaultEnabled =
            DEFAULT_CHECKED_EXTENSIONS.includes(extension) &&
            !DEFAULT_UNCHECKED_PATHS.some((uncheckedPath) =>
              relativePath.toLowerCase().includes(uncheckedPath.toLowerCase())
            );

          return {
            path: relativePath,
            size: Number(stat.size),
            defaultEnabled,
          };
        });
      }).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
    } else if (dirExists) {
      // For standalone videos, use the standalone files directory with full metadata
      const filesInDirectory = yield* fs.readDirectory(standaloneVideoDir);

      files = yield* Effect.forEach(filesInDirectory, (filename) => {
        return Effect.gen(function* () {
          const filePath = getStandaloneVideoFilePath(videoId, filename);
          const stat = yield* fs.stat(filePath);

          if (stat.type !== "File") {
            return null;
          }

          const extension = path.extname(filename).slice(1);
          const defaultEnabled = DEFAULT_CHECKED_EXTENSIONS.includes(extension);

          return {
            path: filename,
            size: Number(stat.size),
            defaultEnabled,
          };
        });
      }).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
    }

    return {
      video,
      items: sortedItems,
      waveformData: undefined,
      hasExplainerFolder,
      videoCount: lesson?.videos.length ?? 1,
      standaloneFiles,
      files,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

// Create ClipService instance for all clip operations
const clipService = createHttpClipService();

/**
 * Returns the default insertion point: below the first section that has no
 * clips after it (before the next section or end of list). Falls back to "end".
 */
function getDefaultInsertionPoint(
  items: TimelineItem[]
): FrontendInsertionPoint {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (
      item.type === "clip-section-on-database" ||
      item.type === "clip-section-optimistically-added"
    ) {
      const nextItem = items[i + 1];
      // Section is "empty" if the next item is another section or there's nothing after it
      const isEmpty =
        !nextItem ||
        nextItem.type === "clip-section-on-database" ||
        nextItem.type === "clip-section-optimistically-added";
      if (isEmpty) {
        return {
          type: "after-clip-section",
          frontendClipSectionId: item.frontendId,
        };
      }
    }
  }
  return { type: "end" };
}

export default function Component(props: Route.ComponentProps) {
  return <ComponentInner {...props} key={props.loaderData.video.id} />;
}

export const ComponentInner = (props: Route.ComponentProps) => {
  const navigate = useNavigate();

  const initialItems: TimelineItem[] = props.loaderData.items.map(
    (item): TimelineItem => {
      if (item.type === "clip") {
        const clip = item.data;
        return {
          ...clip,
          type: "on-database",
          frontendId: createFrontendId(),
          databaseId: clip.id,
          insertionOrder: null,
          beatType: clip.beatType as BeatType,
        } satisfies ClipOnDatabase;
      } else {
        const clipSection = item.data;
        return {
          type: "clip-section-on-database",
          frontendId: createFrontendId(),
          databaseId: clipSection.id,
          name: clipSection.name,
          insertionOrder: null,
        } satisfies ClipSectionOnDatabase;
      }
    }
  );

  const initialState: clipStateReducer.State = {
    items: initialItems,
    clipIdsBeingTranscribed: new Set() satisfies Set<FrontendId>,
    insertionOrder: 0,
    insertionPoint: getDefaultInsertionPoint(initialItems),
    error: null,
    sessions: [],
  };

  const clipStateRef = useRef(initialState);
  const revalidator = useRevalidator();

  const [clipState, dispatch] = useEffectReducer(
    clipStateReducer,
    initialState,
    {
      "archive-clips": (_state, effect, dispatch) => {
        clipService.archiveClips(effect.clipIds).catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "archive-clips",
            message:
              error instanceof Error
                ? error.message
                : "Failed to archive clips",
          });
        });
      },
      "unarchive-clips": (_state, effect, dispatch) => {
        clipService.unarchiveClips(effect.clipIds).catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "unarchive-clips",
            message:
              error instanceof Error
                ? error.message
                : "Failed to unarchive clips",
          });
        });
      },
      "transcribe-clips": (_state, effect, dispatch) => {
        fetch("/clips/transcribe", {
          method: "POST",
          body: JSON.stringify({ clipIds: effect.clipIds }),
        })
          .then((res) => {
            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            return res.json();
          })
          .then((clips: DB.Clip[]) => {
            dispatch({
              type: "clips-transcribed",
              clips: clips.map((clip) => ({
                databaseId: clip.id,
                text: clip.text,
              })),
            });
          })
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "transcribe-clips",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to transcribe clips",
            });
          });
      },
      "scroll-to-insertion-point": () => {
        const recordingPanel = document.querySelector(
          "[data-session-recording]"
        );
        if (recordingPanel) {
          recordingPanel.scrollIntoView({ behavior: "smooth", block: "end" });
          return;
        }
        const sessionPanels = document.getElementById(
          RECORDING_SESSION_PANELS_ID
        );
        if (sessionPanels) {
          sessionPanels.scrollIntoView({ behavior: "smooth", block: "end" });
          return;
        }
        const insertionPoint = document.getElementById(INSERTION_POINT_ID);
        if (insertionPoint) {
          insertionPoint.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      },
      "update-clips": (_state, effect, dispatch) => {
        // Transform tuple format [id, { scene, profile, beatType }] to UpdateClipInput
        const clipsInput = effect.clips.map(([id, data]) => ({
          id,
          scene: data.scene,
          profile: data.profile,
          beatType: data.beatType,
        }));
        clipService.updateClips(clipsInput).catch((error) => {
          dispatch({
            type: "effect-failed",
            effectType: "update-clips",
            message:
              error instanceof Error ? error.message : "Failed to update clips",
          });
        });
      },
      "update-beat": (_state, effect, dispatch) => {
        clipService
          .updateBeat(effect.clipId, effect.beatType)
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "update-beat",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to update beat",
            });
          });
      },
      "reorder-clip": (_state, effect, dispatch) => {
        clipService
          .reorderClip(effect.clipId, effect.direction)
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "reorder-clip",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to reorder clip",
            });
          });
      },
      "reorder-clip-section": (_state, effect, dispatch) => {
        clipService
          .reorderClipSection(effect.clipSectionId, effect.direction)
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "reorder-clip-section",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to reorder clip section",
            });
          });
      },
      "archive-clip-sections": (_state, effect, dispatch) => {
        clipService
          .archiveClipSections(effect.clipSectionIds)
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "archive-clip-sections",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to archive clip sections",
            });
          });
      },
      "create-clip-section": (state, effect, dispatch) => {
        clipService
          .createClipSectionAtInsertionPoint({
            videoId: props.loaderData.video.id,
            name: effect.name,
            insertionPoint: effect.insertionPoint,
            items: state.items,
          })
          .then((clipSection) => {
            dispatch({
              type: "clip-section-created",
              frontendId: effect.frontendId,
              databaseId: clipSection.id as DatabaseId,
            });
          })
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "create-clip-section",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to create clip section",
            });
          });
      },
      "update-clip-section": (_state, effect, dispatch) => {
        clipService
          .updateClipSection(effect.clipSectionId, effect.name)
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "update-clip-section",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to update clip section",
            });
          });
      },
      "start-session-timeout": (_state, effect, dispatch) => {
        const timeout = setTimeout(() => {
          dispatch({
            type: "session-polling-complete",
            sessionId: effect.sessionId,
          });
        }, 10_000);

        return () => {
          clearTimeout(timeout);
        };
      },
      "start-session-polling": (_state, effect, dispatch) => {
        let unmounted = false;

        (async () => {
          while (!unmounted) {
            // Stop polling when session is done
            const session = clipStateRef.current.sessions.find(
              (s) => s.id === effect.sessionId
            );
            if (session?.status === "done") {
              break;
            }
            try {
              const { insertionPoint, items } = clipStateRef.current;
              const clips = await clipService.appendFromObs({
                videoId: props.loaderData.video.id,
                filePath: effect.outputPath,
                insertionPoint,
                items,
              });
              if (clips.length > 0) {
                dispatch({
                  type: "new-database-clips",
                  clips: clips as DB.Clip[],
                  outputPath: effect.outputPath,
                });
              }
            } catch (e) {
              // Errors are swallowed; polling continues
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        })();

        return () => {
          unmounted = true;
        };
      },
      "create-clip-section-at": (_state, effect, dispatch) => {
        clipService
          .createClipSectionAtPosition({
            videoId: props.loaderData.video.id,
            name: effect.name,
            position: effect.position,
            targetItemId: effect.targetItemId,
            targetItemType: effect.targetItemType,
          })
          .then((clipSection) => {
            dispatch({
              type: "clip-section-created",
              frontendId: effect.frontendId,
              databaseId: clipSection.id as DatabaseId,
            });
          })
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "create-clip-section-at",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to create clip section at position",
            });
          });
      },
      "revalidate-loader": () => {
        revalidator.revalidate();
      },
    }
  );

  clipStateRef.current = clipState;

  const obsConnector = useOBSConnector({
    onNewClipOptimisticallyAdded: ({ scene, profile, soundDetectionId }) => {
      dispatch({
        type: "new-optimistic-clip-detected",
        scene,
        profile,
        soundDetectionId,
      });
    },
  });

  // Sync OBS recording state to clip-state-reducer sessions
  const prevOBSStateTypeRef = useRef(obsConnector.state.type);
  useEffect(() => {
    const prevType = prevOBSStateTypeRef.current;
    const currType = obsConnector.state.type;
    prevOBSStateTypeRef.current = currType;

    if (prevType !== "obs-recording" && currType === "obs-recording") {
      dispatch({
        type: "recording-started",
        outputPath:
          obsConnector.state.type === "obs-recording"
            ? obsConnector.state.latestOutputPath
            : "",
      });
    } else if (prevType === "obs-recording" && currType !== "obs-recording") {
      dispatch({ type: "recording-stopped" });
    }
  }, [obsConnector.state.type]);

  return (
    <VideoEditor
      onClipsRemoved={(clipIds) => {
        dispatch({ type: "clips-deleted", clipIds: clipIds });
      }}
      onClipsRetranscribe={(clipIds) => {
        const databaseIds = clipIds
          .map((frontendId) => {
            const clip = clipState.items.find(
              (c) => c.frontendId === frontendId
            );
            return clip?.type === "on-database" ? clip.databaseId : null;
          })
          .filter((id): id is DatabaseId => id !== null);

        fetch("/clips/transcribe", {
          method: "POST",
          body: JSON.stringify({ clipIds: databaseIds }),
        })
          .then((res) => {
            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            return res.json();
          })
          .then((clips: DB.Clip[]) => {
            dispatch({
              type: "clips-transcribed",
              clips: clips.map((clip) => ({
                databaseId: clip.id,
                text: clip.text,
              })),
            });
          })
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "transcribe-clips",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to transcribe clips",
            });
          });
      }}
      insertionPoint={clipState.insertionPoint}
      onSetInsertionPoint={(mode, clipId) => {
        if (mode === "after") {
          dispatch({ type: "set-insertion-point-after", clipId });
        } else {
          dispatch({ type: "set-insertion-point-before", clipId });
        }
      }}
      onDeleteLatestInsertedClip={() => {
        dispatch({ type: "delete-latest-inserted-clip" });
      }}
      onToggleBeat={() => {
        dispatch({ type: "toggle-beat-at-insertion-point" });
      }}
      onToggleBeatForClip={(clipId) => {
        dispatch({ type: "toggle-beat-for-clip", clipId });
      }}
      onMoveClip={(clipId, direction) => {
        dispatch({ type: "move-clip", clipId, direction });
      }}
      onAddClipSection={(name) => {
        dispatch({ type: "add-clip-section", name });
      }}
      onUpdateClipSection={(clipSectionId, name) => {
        dispatch({ type: "update-clip-section", clipSectionId, name });
      }}
      onAddClipSectionAt={(name, position, itemId) => {
        dispatch({ type: "add-clip-section-at", name, position, itemId });
      }}
      onRestoreClip={(clipId) => {
        dispatch({ type: "restore-clip", clipId });
      }}
      onPermanentlyRemoveArchived={(sessionId) => {
        dispatch({ type: "permanently-remove-archived", sessionId });
      }}
      onClearAllArchived={() => {
        dispatch({ type: "permanently-remove-all-archived" });
      }}
      obsConnectorState={obsConnector.state}
      items={clipState.items}
      sessions={clipState.sessions}
      repoId={props.loaderData.video.lesson?.section.repoVersion.repo.id}
      lessonId={props.loaderData.video.lesson?.id}
      videoPath={props.loaderData.video.path}
      lessonPath={props.loaderData.video.lesson?.path}
      repoName={props.loaderData.video.lesson?.section.repoVersion.repo.name}
      videoId={props.loaderData.video.id}
      liveMediaStream={obsConnector.mediaStream}
      speechDetectorState={obsConnector.speechDetectorState}
      clipIdsBeingTranscribed={clipState.clipIdsBeingTranscribed}
      hasExplainerFolder={props.loaderData.hasExplainerFolder}
      videoCount={props.loaderData.videoCount}
      error={clipState.error}
      standaloneFiles={props.loaderData.standaloneFiles}
      files={props.loaderData.files}
      onCreateVideoFromSelection={(
        frontendClipIds,
        frontendClipSectionIds,
        title,
        mode
      ) => {
        // Map frontend IDs to database IDs (cast to string for ClipService)
        const clipIds: string[] = [];
        for (const frontendId of frontendClipIds) {
          const clip = clipState.items.find((c) => c.frontendId === frontendId);
          if (clip?.type === "on-database") {
            clipIds.push(clip.databaseId as string);
          }
        }

        const clipSectionIds: string[] = [];
        for (const frontendId of frontendClipSectionIds) {
          const section = clipState.items.find(
            (c) => c.frontendId === frontendId
          );
          if (section?.type === "clip-section-on-database") {
            clipSectionIds.push(section.databaseId as string);
          }
        }

        clipService
          .createVideoFromSelection({
            sourceVideoId: props.loaderData.video.id,
            clipIds,
            clipSectionIds,
            title,
            mode,
          })
          .then((newVideo) => {
            navigate(`/videos/${newVideo.id}/edit`);
          })
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "create-video-from-selection",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to create video from selection",
            });
          });
      }}
    />
  );
};
