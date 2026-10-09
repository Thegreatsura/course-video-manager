import { useContext, useEffect } from "react";
import { UploadContext } from "@/features/upload-manager/upload-context";
import type { ClipReducerAction } from "./clip-state-reducer.types";
import { clipActionOfJobEvent } from "./transcription-job-events";

/**
 * The bridge from this Video's `transcribe-clips` Job Events to the clip
 * reducer: it only dispatches what it hears (docs/FRONTEND_STATE.md).
 * `loadedThrough`: the newest Job Event id the editor's loader had seen when
 * it read the Clips the reducer started from.
 */
export function useClipTranscriptionJobs(
  scope: { videoId: string; loadedThrough: number },
  dispatch: (action: ClipReducerAction) => void
) {
  const { subscribeToJobEvents } = useContext(UploadContext);
  const { videoId, loadedThrough } = scope;
  useEffect(
    () =>
      subscribeToJobEvents((heard) => {
        const action = clipActionOfJobEvent(heard, { videoId, loadedThrough });
        if (action) dispatch(action);
      }),
    [subscribeToJobEvents, videoId, loadedThrough, dispatch]
  );
}
