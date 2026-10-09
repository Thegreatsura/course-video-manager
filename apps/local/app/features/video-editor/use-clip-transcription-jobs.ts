import { useContext, useEffect } from "react";
import { UploadContext } from "@/features/upload-manager/upload-context";
import type { ClipReducerAction } from "./clip-state-reducer.types";
import { TRANSCRIBE_CLIPS_JOB_KIND } from "./transcribe-clips-response";

/**
 * The bridge from this Video's `transcribe-clips` Job Events to the clip
 * reducer (docs/FRONTEND_STATE.md, rule 7). It subscribes to this Video's
 * Clip transcriptions only, so the editor does not re-render for every other
 * Job's progress, and dispatches each event as it heard it. The reducer
 * decides what the event means, and whether it is one it has already seen.
 */
export function useClipTranscriptionJobs(
  videoId: string,
  dispatch: (action: ClipReducerAction) => void
) {
  const { subscribeToJobEvents } = useContext(UploadContext);
  useEffect(
    () =>
      subscribeToJobEvents((heard) => {
        if (
          heard.job.kind === TRANSCRIBE_CLIPS_JOB_KIND &&
          heard.job.subjectId === videoId
        ) {
          dispatch({ type: "job-event-heard", heard });
        }
      }),
    [subscribeToJobEvents, videoId, dispatch]
  );
}
