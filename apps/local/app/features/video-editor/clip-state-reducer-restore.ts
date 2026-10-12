import {
  clipRestoreRefusal,
  isClipRestoreRefusal,
} from "@cvm/core/features/videos/recorder";
import type { clipStateReducer } from "./clip-state-reducer";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
} from "./clip-state-reducer.types";

type RestoreClip = Extract<clipStateReducer.Action, { type: "restore-clip" }>;
type ClipRestoreFailed = Extract<
  clipStateReducer.Action,
  { type: "clip-restore-failed" }
>;

/**
 * Restore an archived Clip, optimistically. A Clip filmed with the other
 * Recorder than the Video's is refused up front (#2043), the same rule the
 * server enforces: one Video never mixes OBS and CVM-recorder Clips.
 */
export const handleRestoreClip = (
  state: clipStateReducer.State,
  action: RestoreClip,
  exec: Parameters<typeof clipStateReducer>[2]
): clipStateReducer.State => {
  const item = state.items.find((c) => c.frontendId === action.clipId);

  if (
    !item ||
    (item.type !== "optimistically-added" && item.type !== "on-database") ||
    !item.shouldArchive
  ) {
    return state;
  }

  if (item.type === "on-database") {
    const refusal = clipRestoreRefusal(action.videoRecorder, {
      recordingSessionId: item.recordingSession?.id ?? null,
    });
    if (refusal) {
      exec({ type: "show-clip-restore-refused-toast", message: refusal });
      return state;
    }
    exec({ type: "unarchive-clips", clipIds: [item.databaseId] });
  }

  return {
    ...state,
    items: state.items.map((c) => {
      if (c.frontendId === action.clipId) {
        const { shouldArchive: _, ...rest } = c as
          ClipOnDatabase | ClipOptimisticallyAdded;
        return rest;
      }
      return c;
    }),
  };
};

/**
 * The server did not restore these Clips: archive them again so the editor
 * matches the database. A Recorder refusal (`clipRestoreRefusal`) is shown
 * and editing carries on; any other failure is fatal, like every other.
 */
export const handleClipRestoreFailed = (
  state: clipStateReducer.State,
  action: ClipRestoreFailed,
  exec: Parameters<typeof clipStateReducer>[2]
): clipStateReducer.State => {
  const failed = new Set<string>(action.clipIds);
  const items = state.items.map((item) =>
    item.type === "on-database" && failed.has(item.databaseId)
      ? { ...item, shouldArchive: true }
      : item
  );

  if (isClipRestoreRefusal(action.message)) {
    exec({ type: "show-clip-restore-refused-toast", message: action.message });
    return { ...state, items };
  }

  return {
    ...state,
    items,
    error: {
      message: action.message,
      effectType: "unarchive-clips",
      timestamp: Date.now(),
    },
  };
};
