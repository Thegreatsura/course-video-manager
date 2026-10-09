import type { EffectReducer } from "use-effect-reducer";
import type { JobEventMessage } from "@/features/jobs/job-wire";
import {
  filesSafeToRemove,
  imageUploadsOf,
  localImageRefs,
  type ImageUploaded,
} from "./image-upload-job";

/**
 * One body's "upload its local images" (the Article Writer's Apply, the
 * Skills Changelog's "Upload Images"), as an `upload-images` Job the Sidecar
 * runs. This surface asks for the Job, hears its `image-uploaded` events,
 * and once it settles swaps the URLs into the body AS IT IS THEN and saves
 * it (`swap-into-body`), so the author's edits made meanwhile survive.
 *
 * A file is removed only on `body-saved`, the save's confirmation, and only
 * if the saved body names it in no form and the author asked for that. A
 * save that fails removes nothing; its files wait for a later save.
 */
export namespace imageUploadReducer {
  export interface State {
    /** The Job this surface waits on; `null` when none is running. */
    jobId: string | null;
    videoId: string | null;
    deleteLocalFiles: boolean;
    /** Its images uploaded so far, each reference once. */
    uploads: ImageUploaded[];
    /** The swapped body is being saved: no new upload until it lands. */
    saving: boolean;
    /**
     * Files the author asked to remove, swapped into a body whose save
     * failed: removable once a later save lands without them.
     */
    unsavedRemovals: string[];
  }

  export type Action =
    | {
        type: "upload-pressed";
        /** Chosen by the hook (`crypto.randomUUID()`), never here. */
        jobId: string;
        videoId: string;
        /** The body as it was pressed: what the Job uploads from. */
        body: string;
        deleteLocalFiles: boolean;
      }
    | { type: "job-event-heard"; heard: JobEventMessage }
    /** The jobs reducer failed the Job before the Sidecar heard of it. */
    | { type: "job-enqueue-failed"; jobId: string }
    | {
        /** The swapped body's save is confirmed. */
        type: "body-saved";
        videoId: string;
        /** The body exactly as saved. */
        savedBody: string;
        swappedFilePaths: string[];
        deleteLocalFiles: boolean;
      }
    | {
        type: "body-save-failed";
        videoId: string;
        swappedFilePaths: string[];
        deleteLocalFiles: boolean;
      };

  export type Effect =
    | {
        type: "start-upload-job";
        jobId: string;
        videoId: string;
        body: string;
      }
    | {
        /** Swap `uploads` into the current body, save it, report the save. */
        type: "swap-into-body";
        videoId: string;
        uploads: ImageUploaded[];
        deleteLocalFiles: boolean;
      }
    | { type: "remove-local-images"; videoId: string; filePaths: string[] }
    /** Tell the surface its body is saved (the writer closes on this). */
    | { type: "report-saved"; body: string }
    | { type: "show-save-failed-toast"; message: string };
}

export const createInitialImageUploadState = (): imageUploadReducer.State => ({
  jobId: null,
  videoId: null,
  deleteLocalFiles: false,
  uploads: [],
  saving: false,
  unsavedRemovals: [],
});

/** The Job's own end: whatever it recorded is swapped in, success or not. */
const SETTLED_EVENTS = new Set(["succeeded", "failed", "interrupted"]);

type Exec = Parameters<
  EffectReducer<
    imageUploadReducer.State,
    imageUploadReducer.Action,
    imageUploadReducer.Effect
  >
>[2];

const settle = (
  state: imageUploadReducer.State,
  exec: Exec
): imageUploadReducer.State => {
  exec({
    type: "swap-into-body",
    videoId: state.videoId!,
    uploads: state.uploads,
    deleteLocalFiles: state.deleteLocalFiles,
  });
  return {
    ...createInitialImageUploadState(),
    saving: true,
    unsavedRemovals: state.unsavedRemovals,
  };
};

export const imageUploadReducer: EffectReducer<
  imageUploadReducer.State,
  imageUploadReducer.Action,
  imageUploadReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "upload-pressed": {
      // A second press while one runs, or saves, is the same request.
      if (state.jobId !== null || state.saving) return state;
      // Nothing local to upload: nothing to wait for.
      if (localImageRefs(action.body).length === 0) {
        exec({
          type: "swap-into-body",
          videoId: action.videoId,
          uploads: [],
          deleteLocalFiles: false,
        });
        return { ...state, saving: true };
      }
      exec({
        type: "start-upload-job",
        jobId: action.jobId,
        videoId: action.videoId,
        body: action.body,
      });
      return {
        jobId: action.jobId,
        videoId: action.videoId,
        deleteLocalFiles: action.deleteLocalFiles,
        uploads: [],
        saving: false,
        unsavedRemovals: state.unsavedRemovals,
      };
    }
    case "job-event-heard": {
      const { job, event } = action.heard;
      if (state.jobId === null || job.id !== state.jobId) return state;
      if (SETTLED_EVENTS.has(event.type)) return settle(state, exec);
      const [upload] = imageUploadsOf([event]);
      if (!upload || state.uploads.some((u) => u.ref === upload.ref)) {
        return state;
      }
      return { ...state, uploads: [...state.uploads, upload] };
    }
    case "job-enqueue-failed":
      return state.jobId === action.jobId ? settle(state, exec) : state;
    case "body-saved": {
      const asked = new Set(state.unsavedRemovals);
      if (action.deleteLocalFiles) {
        for (const filePath of action.swappedFilePaths) asked.add(filePath);
      }
      const filePaths = filesSafeToRemove(action.savedBody, [...asked]);
      if (filePaths.length > 0) {
        exec({
          type: "remove-local-images",
          videoId: action.videoId,
          filePaths,
        });
      }
      exec({ type: "report-saved", body: action.savedBody });
      return { ...state, saving: false, unsavedRemovals: [] };
    }
    case "body-save-failed":
      exec({
        type: "show-save-failed-toast",
        message: "Couldn't save the body. Its local images were kept.",
      });
      return {
        ...state,
        saving: false,
        unsavedRemovals: action.deleteLocalFiles
          ? [...new Set([...state.unsavedRemovals, ...action.swappedFilePaths])]
          : state.unsavedRemovals,
      };
  }
};
