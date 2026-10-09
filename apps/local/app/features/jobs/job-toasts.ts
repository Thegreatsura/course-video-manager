import { toast } from "@/components/ui/toast";
import { showSuccessToast } from "@/features/upload-manager/upload-toasts";
import { isPostingJobKind, jobLogHref } from "./job-wire";
import type { jobsReducer } from "./jobs-reducer";
import { jobUploadEntries, jobUploadEntry } from "./jobs-selectors";

type Toast<T extends jobsReducer.Effect["type"]> = Extract<
  jobsReducer.Effect,
  { type: T }
>;

/** What a kind of Job did, for the toast's headline. */
const DID: Record<string, string> = {
  export: "exported successfully",
  "render-vertical": "rendered as a vertical Short",
};
const FAILED: Record<string, string> = {
  export: "export failed",
  "render-vertical": "vertical Short render failed",
  youtube: "upload failed",
  "youtube-shorts": "YouTube Short post failed",
  buffer: "Buffer post failed",
  "ai-hero": "AI Hero post failed",
  "skills-changelog": "Skills Changelog post failed",
  autofill: "failed",
  /** One Video of a Course Autofill: nothing of it was written. */
  "autofill-video": "autofill failed",
  publish: "publish failed",
  /** One Video of a Publish: its export or its upload. */
  "publish-video": "failed in the Publish",
};

export function showJobSucceededToast(
  effect: Toast<"show-job-succeeded-toast">,
  job: jobsReducer.JobView | null
): void {
  // A post toasts exactly as the browser-driven upload did: same words,
  // same links, and AI Hero's link saved to the global links.
  // So does an Autofill: "<title> finished", with "Back to Publish"; and a
  // Publish: "published successfully", with "Go to Draft".
  const entry = !job
    ? null
    : isPostingJobKind(job.kind)
      ? jobUploadEntry(job)
      : job.kind === "autofill" || job.kind === "publish"
        ? (jobUploadEntries(job)[0] ?? null)
        : null;
  if (entry) {
    showSuccessToast(entry);
    return;
  }
  const did = DID[effect.kind] ?? "finished";
  toast.success(`"${effect.title}" ${did}`, {
    duration: Infinity,
    // The export's toast as the browser-driven export showed it.
    cancel:
      effect.kind === "export" && effect.subjectId
        ? {
            label: "Open",
            onClick: () => {
              fetch(`/api/videos/${effect.subjectId}/reveal`, {
                method: "POST",
              }).catch(() => {
                // Revealing the file is a convenience; the toast said where it is.
              });
            },
          }
        : undefined,
  });
}

export function showJobFailedToast(
  effect: Toast<"show-job-failed-toast">
): void {
  const failed = FAILED[effect.kind] ?? "failed";
  toast.error(`"${effect.title}" ${failed}: ${effect.message}`, {
    duration: Infinity,
    // `action` is the error toast's "Copy"; the log goes beside it.
    cancel: effect.hasLog
      ? {
          label: "View log",
          onClick: () => {
            window.open(jobLogHref(effect.jobId), "_blank", "noopener");
          },
        }
      : undefined,
  });
}

export function showSidecarNotRunningToast(
  effect: Toast<"show-sidecar-not-running-toast">
): void {
  toast.warning(`"${effect.title}" is queued, but the sidecar is not running`, {
    description:
      "It starts as soon as the sidecar does: `pnpm dev` and `pnpm start` run it.",
  });
}

export function showRetryFailedToast(
  effect: Toast<"show-retry-failed-toast">
): void {
  toast.error(`Could not retry "${effect.title}": ${effect.message}`, {
    duration: Infinity,
  });
}

export function showDismissFailedToast(
  effect: Toast<"show-dismiss-failed-toast">
): void {
  const what = effect.count === 1 ? "that row" : `${effect.count} rows`;
  toast.error(
    `Could not dismiss ${what} for good, so it will be back in the next tab: ${effect.message}`
  );
}
