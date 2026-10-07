import type { uploadReducer } from "./upload-reducer";

/** What the provider must do in response to one upload changing status. */
export type UploadReaction =
  | { type: "success-toast"; upload: uploadReducer.UploadEntry }
  | { type: "error-toast"; upload: uploadReducer.UploadEntry }
  | {
      /**
       * Re-run the upload's job with the params it was started with. `retry`
       * means the reducer must first be told (RETRY) to reset the entry.
       */
      type: "initiate";
      uploadId: string;
      upload: uploadReducer.UploadEntry;
      params: unknown;
      retry: boolean;
    };

/**
 * The reactions to every status change between two snapshots of the uploads:
 * toasts for finished jobs, a restart for a job the reducer marked
 * `retrying`, and a start for a job whose dependency just completed
 * (`waiting` → `uploading`). Restarts recover the params the job was started
 * with from `paramsByUploadId`.
 */
export function planUploadReactions(
  previous: uploadReducer.State["uploads"],
  current: uploadReducer.State["uploads"],
  paramsByUploadId: ReadonlyMap<string, { params: unknown }>
): UploadReaction[] {
  const reactions: UploadReaction[] = [];

  for (const [uploadId, upload] of Object.entries(current)) {
    const prevUpload = previous[uploadId];
    if (!prevUpload) continue;
    if (prevUpload.status === upload.status) continue;

    // A child task's success is reported by its row under its parent; the
    // parent's own toast speaks for the job as a whole. Failures still toast
    // per child, because that is how a single stuck Video gets named.
    if (upload.status === "success" && !upload.parentUploadId) {
      reactions.push({ type: "success-toast", upload });
    }

    if (upload.status === "error") {
      reactions.push({ type: "error-toast", upload });
    }

    const params = paramsByUploadId.get(uploadId)?.params;

    if (upload.status === "retrying") {
      reactions.push({
        type: "initiate",
        uploadId,
        upload,
        params,
        retry: true,
      });
    }

    if (prevUpload.status === "waiting" && upload.status === "uploading") {
      reactions.push({
        type: "initiate",
        uploadId,
        upload,
        params,
        retry: false,
      });
    }
  }

  return reactions;
}
