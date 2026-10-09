import { useCallback, useContext, useEffect, useRef } from "react";
import { useEffectReducer } from "use-effect-reducer";
import { toast } from "@/components/ui/toast";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { UPLOAD_IMAGES_JOB_KIND, swapImageUploads } from "./image-upload-job";
import {
  createInitialImageUploadState,
  imageUploadReducer,
} from "./image-upload-reducer";

export interface ImageUploadBody {
  /** The body as it is right now. */
  read: () => string;
  /**
   * Put the swapped body in place and persist it. Resolve only once the save
   * is confirmed; reject if it failed. No local file is removed unless this
   * resolves.
   */
  save: (body: string) => Promise<void>;
  /** Called once the swapped body is saved, with that body. */
  onSaved?: (body: string) => void;
}

/**
 * Upload a body's local images as an `upload-images` Job, and swap the URLs
 * into the body once it settles (`image-upload-reducer.ts`). The effect
 * runner below only calls out; every decision is the reducer's.
 */
export function useImageUploadJob(videoId: string, body: ImageUploadBody) {
  const { jobs, subscribeToJobEvents, startImageUpload, removeLocalImages } =
    useContext(UploadContext);
  // The body's accessors change every render; the runner reads the newest.
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const [state, dispatch] = useEffectReducer(
    imageUploadReducer,
    createInitialImageUploadState(),
    {
      "start-upload-job": (_state, effect) => {
        startImageUpload(effect.jobId, effect.videoId, effect.body);
      },
      "swap-into-body": (_state, effect, dispatch) => {
        const swapped = swapImageUploads(
          bodyRef.current.read(),
          effect.uploads
        );
        // Promise.resolve().then: a save that throws before its promise is
        // a failed save too.
        Promise.resolve()
          .then(() => bodyRef.current.save(swapped.body))
          .then(
            () =>
              dispatch({
                type: "body-saved",
                videoId: effect.videoId,
                savedBody: swapped.body,
                swappedFilePaths: swapped.swappedFilePaths,
                deleteLocalFiles: effect.deleteLocalFiles,
              }),
            () =>
              dispatch({
                type: "body-save-failed",
                videoId: effect.videoId,
                swappedFilePaths: swapped.swappedFilePaths,
                deleteLocalFiles: effect.deleteLocalFiles,
              })
          );
      },
      "remove-local-images": (_state, effect) => {
        removeLocalImages(effect.videoId, effect.filePaths);
      },
      "report-saved": (_state, effect) => {
        bodyRef.current.onSaved?.(effect.body);
      },
      "show-save-failed-toast": (_state, effect) => {
        toast.error(effect.message);
      },
    }
  );

  // Bridges (docs/FRONTEND_STATE.md, rule 7): this Video's image uploads off
  // the Job Event stream, and a request the jobs reducer failed outright.
  useEffect(
    () =>
      subscribeToJobEvents((heard) => {
        if (
          heard.job.kind === UPLOAD_IMAGES_JOB_KIND &&
          heard.job.subjectId === videoId
        ) {
          dispatch({ type: "job-event-heard", heard });
        }
      }),
    [subscribeToJobEvents, videoId, dispatch]
  );
  const requestedStatus = state.jobId
    ? jobs.jobs[state.jobId]?.status
    : undefined;
  useEffect(() => {
    if (state.jobId && requestedStatus === "failed") {
      dispatch({ type: "job-enqueue-failed", jobId: state.jobId });
    }
  }, [state.jobId, requestedStatus, dispatch]);

  const upload = useCallback(
    (deleteLocalFiles: boolean) =>
      dispatch({
        type: "upload-pressed",
        jobId: crypto.randomUUID(),
        videoId,
        body: bodyRef.current.read(),
        deleteLocalFiles,
      }),
    [dispatch, videoId]
  );

  return { isUploading: state.jobId !== null || state.saving, upload };
}
