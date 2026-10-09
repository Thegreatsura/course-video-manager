import { useContext, useEffect } from "react";
import { UploadContext } from "@/features/upload-manager/upload-context";
import type { ClipReducerAction } from "./clip-state-reducer.types";
import { TRANSCRIBE_CLIPS_JOB_KIND } from "./transcribe-clips-response";

/**
 * The bridge from this Video's `transcribe-clips` Jobs to the clip reducer
 * (docs/FRONTEND_STATE.md, rule 7). It subscribes to this Video's Clip
 * transcription events only, so the editor does not re-render for every
 * other Job's progress, and to this tab's requests the server joined to a
 * live Job. It dispatches each as it heard it: the reducer decides what an
 * event means, and whether it has seen it already.
 */
export function useClipTranscriptionJobs(
  videoId: string,
  dispatch: (action: ClipReducerAction) => void
) {
  const { subscribeToJobEvents, subscribeToJobJoins } =
    useContext(UploadContext);
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
  useEffect(
    () =>
      subscribeToJobJoins((joined) =>
        dispatch({
          type: "transcription-job-joined",
          requestedJobId: joined.id,
          jobId: joined.jobId,
        })
      ),
    [subscribeToJobJoins, dispatch]
  );
}
