import type { EffectReducer } from "use-effect-reducer";
import type { FrontendId } from "./clip-state-reducer";

export type RunningState = "playing" | "paused";

export namespace videoStateReducer {
  export interface State {
    clipIdsPreloaded: Set<FrontendId>;
    runningState: RunningState;
    currentClipId: FrontendId | undefined;
    currentTimeInClip: number;
    selectedClipsSet: Set<FrontendId>;
    playbackRate: number;
    /**
     * Whether to show the last frame of the video.
     */
    showLastFrameOfVideo: boolean;
  }

  export type Effect =
    | {
        type: "archive-clips";
        clipIds: FrontendId[];
      }
    | {
        type: "retranscribe-clips";
        clipIds: FrontendId[];
      }
    | {
        type: "toggle-beat-for-clip";
        clipId: FrontendId;
      }
    | {
        type: "move-clip";
        clipId: FrontendId;
        direction: "up" | "down";
      };

  export type Action =
    | {
        type: "press-pause";
      }
    | {
        type: "press-play";
      }
    | {
        type: "click-clip";
        clipId: FrontendId;
        ctrlKey: boolean;
        shiftKey: boolean;
      }
    | {
        type: "update-clip-current-time";
        time: number;
      }
    | {
        type: "clip-finished";
      }
    | {
        type: "press-delete";
      }
    | {
        type: "press-space-bar";
      }
    | {
        type: "press-return";
      }
    | {
        type: "press-arrow-left";
      }
    | {
        type: "press-arrow-right";
      }
    | {
        type: "press-arrow-up";
      }
    | {
        type: "press-arrow-down";
      }
    | {
        type: "press-l";
      }
    | {
        type: "press-home";
      }
    | {
        type: "press-end";
      }
    | {
        type: "press-k";
      }
    | {
        type: "toggle-last-frame-of-video";
      }
    | {
        type: "delete-clip";
        clipId: FrontendId;
      }
    | {
        type: "retranscribe-clip";
        clipId: FrontendId;
      }
    | {
        type: "beat-toggle-key-pressed";
      }
    | {
        type: "press-alt-arrow-up";
      }
    | {
        type: "press-alt-arrow-down";
      }
    | {
        type: "play-from-clip-section";
        clipSectionId: FrontendId;
      };
}

const preloadSelectedClips = (
  clipIds: FrontendId[],
  state: videoStateReducer.State
): videoStateReducer.State => {
  if (!state.currentClipId) {
    return state;
  }

  const currentClipIndex = clipIds.findIndex(
    (clipId) => clipId === state.currentClipId
  );

  if (currentClipIndex === -1) {
    return state;
  }

  const nextClip = clipIds[currentClipIndex + 1];
  const nextNextClip = clipIds[currentClipIndex + 2];

  if (nextClip) {
    state.clipIdsPreloaded.add(nextClip);
  }
  if (nextNextClip) {
    state.clipIdsPreloaded.add(nextNextClip);
  }

  // Add currentClipId to preloaded set, then union with selectedClipsSet
  // Note: Using spread instead of Set.union() for Node 20 compatibility
  state.clipIdsPreloaded.add(state.currentClipId);
  const newClipIdsPreloaded = new Set([
    ...state.clipIdsPreloaded,
    ...state.selectedClipsSet,
  ]);

  return {
    ...state,
    clipIdsPreloaded: newClipIdsPreloaded,
  };
};

/**
 * Creates the video editor reducer.
 *
 * @param itemIds - All timeline item IDs (clips + clip sections) for navigation (arrow keys, Home/End)
 * @param clipIds - Only clip IDs (subset of itemIds) for video playback operations
 *                  (preloading, clip-finished) since clip sections have no video
 */
export const makeVideoEditorReducer =
  (
    itemIds: FrontendId[],
    clipIds: FrontendId[]
  ): EffectReducer<
    videoStateReducer.State,
    videoStateReducer.Action,
    videoStateReducer.Effect
  > =>
  (state, action, exec) => {
    switch (action.type) {
      case "toggle-last-frame-of-video":
        return {
          ...state,
          showLastFrameOfVideo: !state.showLastFrameOfVideo,
          runningState: "paused",
        };
      case "press-space-bar": {
        const newRunningState =
          state.runningState === "playing" ? "paused" : "playing";

        return {
          ...state,
          runningState: newRunningState,
          showLastFrameOfVideo:
            newRunningState === "playing" ? false : state.showLastFrameOfVideo,
        };
      }
      case "press-home":
        const firstItem = itemIds[0];
        if (!firstItem) {
          return state;
        }
        return { ...state, selectedClipsSet: new Set([firstItem]) };
      case "press-end":
        const lastItem = itemIds[itemIds.length - 1];
        if (!lastItem) {
          return state;
        }
        return {
          ...state,
          selectedClipsSet: new Set([lastItem]),
        };
      case "press-l":
        if (state.playbackRate === 2) {
          return {
            ...state,
            playbackRate: 2,
            runningState:
              state.runningState === "playing" ? "paused" : "playing",
          };
        }
        return { ...state, playbackRate: 2, runningState: "playing" };
      case "press-k":
        if (state.playbackRate === 1) {
          return {
            ...state,
            playbackRate: 1,
            runningState:
              state.runningState === "playing" ? "paused" : "playing",
          };
        }
        return { ...state, playbackRate: 1, runningState: "playing" };
      case "press-pause":
        return { ...state, runningState: "paused" };
      case "press-play":
        return { ...state, runningState: "playing" };
      case "press-return": {
        const newRunningState =
          state.runningState === "playing" ? "paused" : "playing";
        const newShowLastFrameOfVideo =
          newRunningState === "playing" ? false : state.showLastFrameOfVideo;
        if (state.selectedClipsSet.size === 0) {
          return {
            ...state,
            runningState: newRunningState,
            showLastFrameOfVideo: newShowLastFrameOfVideo,
          };
        }
        const mostRecentItemId = Array.from(state.selectedClipsSet).pop()!;

        // Check if the selected item is a clip section (not in clipIds)
        const clipIdsSet = new Set(clipIds);
        const isClipSection = !clipIdsSet.has(mostRecentItemId);

        if (isClipSection) {
          // If it's a clip section, find the first clip after it and play from there
          const clipSectionIndex = itemIds.findIndex(
            (id) => id === mostRecentItemId
          );

          if (clipSectionIndex === -1) {
            return state;
          }

          // Find the first clip that comes after this clip section
          let firstClipAfterSection: FrontendId | undefined;
          for (let i = clipSectionIndex + 1; i < itemIds.length; i++) {
            if (clipIdsSet.has(itemIds[i]!)) {
              firstClipAfterSection = itemIds[i];
              break;
            }
          }

          if (!firstClipAfterSection) {
            // No clip after this section
            return state;
          }

          return preloadSelectedClips(clipIds, {
            ...state,
            currentClipId: firstClipAfterSection,
            runningState: "playing",
            currentTimeInClip: 0,
            selectedClipsSet: new Set([firstClipAfterSection]),
          });
        }

        if (state.currentClipId === mostRecentItemId) {
          return {
            ...state,
            selectedClipsSet: new Set([state.currentClipId]),
            runningState: newRunningState,
            showLastFrameOfVideo: newShowLastFrameOfVideo,
          };
        }

        return preloadSelectedClips(clipIds, {
          ...state,
          currentClipId: mostRecentItemId,
          runningState: "playing",
          currentTimeInClip: 0,
          selectedClipsSet: new Set([mostRecentItemId]),
        });
      }
      case "play-from-clip-section": {
        // Find the clip section's position in itemIds
        const clipSectionIndex = itemIds.findIndex(
          (id) => id === action.clipSectionId
        );

        if (clipSectionIndex === -1) {
          return state;
        }

        // Find the first clip that comes after this clip section in itemIds
        // by looking for the first item after clipSectionIndex that exists in clipIds
        const clipIdsSet = new Set(clipIds);
        let firstClipAfterSection: FrontendId | undefined;

        for (let i = clipSectionIndex + 1; i < itemIds.length; i++) {
          if (clipIdsSet.has(itemIds[i]!)) {
            firstClipAfterSection = itemIds[i];
            break;
          }
        }

        if (!firstClipAfterSection) {
          // No clip after this section, just select the clip section
          return {
            ...state,
            selectedClipsSet: new Set([action.clipSectionId]),
          };
        }

        // Play from the first clip after the section
        return preloadSelectedClips(clipIds, {
          ...state,
          currentClipId: firstClipAfterSection,
          runningState: "playing",
          currentTimeInClip: 0,
          selectedClipsSet: new Set([firstClipAfterSection]),
        });
      }
      case "click-clip":
        if (action.ctrlKey) {
          const newSelectedClipsSet = new Set(state.selectedClipsSet);
          if (newSelectedClipsSet.has(action.clipId)) {
            newSelectedClipsSet.delete(action.clipId);
          } else {
            newSelectedClipsSet.add(action.clipId);
          }
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: newSelectedClipsSet,
          });
        } else if (action.shiftKey) {
          const mostRecentItemId = Array.from(state.selectedClipsSet).pop();

          if (!mostRecentItemId) {
            return preloadSelectedClips(clipIds, {
              ...state,
              selectedClipsSet: new Set([action.clipId]),
            });
          }

          const mostRecentItemIndex = itemIds.findIndex(
            (itemId) => itemId === mostRecentItemId
          );

          if (mostRecentItemIndex === -1) {
            return state;
          }

          const newItemIndex = itemIds.findIndex(
            (itemId) => itemId === action.clipId
          );

          if (newItemIndex === -1) {
            return state;
          }
          const firstIndex = Math.min(mostRecentItemIndex, newItemIndex);
          const lastIndex = Math.max(mostRecentItemIndex, newItemIndex);

          const itemsBetween = itemIds.slice(firstIndex, lastIndex + 1);

          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set(itemsBetween),
          });
        } else {
          if (state.selectedClipsSet.size > 1) {
            return preloadSelectedClips(clipIds, {
              ...state,
              selectedClipsSet: new Set([action.clipId]),
            });
          }

          if (state.selectedClipsSet.has(action.clipId)) {
            return preloadSelectedClips(clipIds, {
              ...state,
              currentClipId: action.clipId,
              runningState: "playing",
              currentTimeInClip: 0,
            });
          }
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([action.clipId]),
          });
        }
      case "press-delete": {
        // Handle deletion of both clips and clip sections
        // First check if there are any selected items at all
        if (state.selectedClipsSet.size === 0) {
          return state;
        }

        // Find clips that are being deleted (for selection management)
        const lastClipBeingDeletedIndex = clipIds.findLastIndex((clipId) => {
          return state.selectedClipsSet.has(clipId);
        });

        // Determine next clip to select (only from clips, not clip sections)
        let newSelectedClipId: FrontendId | undefined;
        if (lastClipBeingDeletedIndex !== -1) {
          const clipToMoveSelectionTo = clipIds[lastClipBeingDeletedIndex + 1];
          const backupClipToMoveSelectionTo =
            clipIds[lastClipBeingDeletedIndex - 1];
          const finalBackupClipToMoveSelectionTo = clipIds[0];

          newSelectedClipId =
            clipToMoveSelectionTo ??
            backupClipToMoveSelectionTo ??
            finalBackupClipToMoveSelectionTo;
        } else {
          // Only clip sections were selected, keep first clip selected
          newSelectedClipId = clipIds[0];
        }

        const isCurrentClipDeleted =
          state.currentClipId &&
          state.selectedClipsSet.has(state.currentClipId);

        exec({
          type: "archive-clips",
          clipIds: Array.from(state.selectedClipsSet),
        });

        return preloadSelectedClips(clipIds, {
          ...state,
          selectedClipsSet: new Set(
            [newSelectedClipId].filter((id) => id !== undefined)
          ),
          runningState: isCurrentClipDeleted ? "paused" : state.runningState,
          currentClipId: isCurrentClipDeleted
            ? newSelectedClipId!
            : state.currentClipId,
        });
      }

      case "update-clip-current-time":
        return { ...state, currentTimeInClip: action.time };
      case "clip-finished": {
        const currentClipIndex = clipIds.findIndex(
          (clipId) => clipId === state.currentClipId
        );

        if (currentClipIndex === -1) {
          return state;
        }

        const nextClip = clipIds[currentClipIndex + 1];
        const nextNextClip = clipIds[currentClipIndex + 2];

        const newClipIdsPreloaded = state.clipIdsPreloaded;

        if (nextClip) {
          newClipIdsPreloaded.add(nextClip);
        }

        if (nextNextClip) {
          newClipIdsPreloaded.add(nextNextClip);
        }

        if (nextClip) {
          return {
            ...state,
            currentClipId: nextClip,
            clipIdsPreloaded: newClipIdsPreloaded,
          };
        } else {
          return { ...state, runningState: "paused" };
        }
      }
      case "press-arrow-up":
      case "press-arrow-left": {
        if (state.selectedClipsSet.size === 0 && state.currentClipId) {
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([state.currentClipId]),
          });
        }

        const mostRecentItemId = Array.from(state.selectedClipsSet).pop()!;

        const currentItemIndex = itemIds.findIndex(
          (itemId) => itemId === mostRecentItemId
        );
        const previousItem = itemIds[currentItemIndex - 1];
        if (previousItem) {
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([previousItem]),
          });
        } else {
          return state;
        }
      }
      case "press-arrow-down":
      case "press-arrow-right": {
        if (state.selectedClipsSet.size === 0 && state.currentClipId) {
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([state.currentClipId]),
          });
        }

        const mostRecentItemId = Array.from(state.selectedClipsSet).pop()!;

        const currentItemIndex = itemIds.findIndex(
          (itemId) => itemId === mostRecentItemId
        );
        const nextItem = itemIds[currentItemIndex + 1];
        if (nextItem) {
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([nextItem]),
          });
        } else {
          return state;
        }
      }
      case "delete-clip": {
        exec({
          type: "archive-clips",
          clipIds: [action.clipId],
        });

        const deletedClipIndex = clipIds.findIndex(
          (id) => id === action.clipId
        );
        const nextClip =
          clipIds[deletedClipIndex + 1] ??
          clipIds[deletedClipIndex - 1] ??
          clipIds[0];

        return preloadSelectedClips(clipIds, {
          ...state,
          selectedClipsSet: new Set(
            [nextClip].filter((id) => id !== undefined)
          ),
          runningState:
            state.currentClipId === action.clipId
              ? "paused"
              : state.runningState,
        });
      }
      case "retranscribe-clip": {
        exec({
          type: "retranscribe-clips",
          clipIds: [action.clipId],
        });
        return state;
      }
      case "beat-toggle-key-pressed": {
        const selectedClipId = Array.from(state.selectedClipsSet).pop();
        if (selectedClipId) {
          exec({
            type: "toggle-beat-for-clip",
            clipId: selectedClipId,
          });
        }
        return state;
      }
      case "press-alt-arrow-up": {
        const selectedClipId = Array.from(state.selectedClipsSet).pop();
        if (selectedClipId) {
          exec({
            type: "move-clip",
            clipId: selectedClipId,
            direction: "up",
          });
        }
        return state;
      }
      case "press-alt-arrow-down": {
        const selectedClipId = Array.from(state.selectedClipsSet).pop();
        if (selectedClipId) {
          exec({
            type: "move-clip",
            clipId: selectedClipId,
            direction: "down",
          });
        }
        return state;
      }
    }
    action satisfies never;
  };
