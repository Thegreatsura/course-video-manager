import { toast } from "@/components/ui/toast";
import { jobLogHref } from "./job-wire";
import type { jobsReducer } from "./jobs-reducer";

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
};

export function showJobSucceededToast(
  effect: Toast<"show-job-succeeded-toast">
): void {
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
