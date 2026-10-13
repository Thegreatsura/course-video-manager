import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StorageJobView } from "./storage-jobs";

const STAGE_LABELS: Record<string, string> = {
  checking: "Checking",
  copying: "Copying",
  deleting: "Working",
};

/**
 * The storage Jobs a page follows (#2157): each move or delete running in
 * the Sidecar, live from its Job Events, with its progress, its Cancel and,
 * once settled, what it did ("2 deleted (5.0 GB); 1 file still on D:,
 * retry") and the files it left.
 */
export function StorageJobsPanel({
  jobs,
  onCancel,
}: {
  jobs: readonly StorageJobView[];
  onCancel: (jobId: string) => void;
}) {
  if (jobs.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="storage-jobs">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="rounded-lg border p-3 text-sm space-y-1"
          data-testid="storage-job"
          data-status={job.status}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 font-medium">
              {job.live ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : job.status === "succeeded" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
              ) : (
                <XCircle className="w-4 h-4 shrink-0 text-destructive" />
              )}
              {job.title}
            </div>
            {job.cancellable && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCancel(job.id)}
                data-testid="storage-job-cancel"
              >
                Cancel
              </Button>
            )}
          </div>
          {job.live && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${job.percent ?? 0}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {job.cancelRequested
                  ? "Stopping before the next file…"
                  : job.status === "queued" || job.status === "requested"
                    ? "Queued"
                    : `${STAGE_LABELS[job.stage ?? ""] ?? "Running"} ${job.percent ?? 0}%`}
              </span>
            </div>
          )}
          {!job.live && (
            <div
              className={job.status === "succeeded" ? "" : "text-destructive"}
              data-testid="storage-job-result"
            >
              {job.status === "cancelled"
                ? `Cancelled. ${job.summary ?? ""}`
                : (job.summary ?? job.errorMessage ?? job.status)}
            </div>
          )}
          {job.left.length > 0 && (
            <ul className="list-disc pl-5 text-destructive">
              {job.left.slice(0, 10).map((l) => (
                <li key={l.path} className="break-all">
                  {l.path}: {l.message}
                </li>
              ))}
              {job.left.length > 10 && (
                <li>…and {job.left.length - 10} more</li>
              )}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
