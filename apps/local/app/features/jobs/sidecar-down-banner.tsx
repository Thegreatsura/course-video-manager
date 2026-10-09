import { AlertTriangle } from "lucide-react";
import type { jobsReducer } from "./jobs-reducer";

/**
 * On every page, for as long as the Sidecar is down: nothing in the
 * background runs, and every export, render and post waits in the queue. A
 * row's spinner alone said none of that — Jobs stalled silently behind a
 * sidecar nobody had restarted.
 */
export function SidecarDownBanner({
  sidecar,
  message,
}: {
  sidecar: jobsReducer.SidecarStatus;
  message: string | null;
}) {
  if (sidecar !== "not-running") return null;
  return (
    <div
      role="alert"
      title={message ?? undefined}
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex max-w-xl items-start gap-3 rounded-lg border border-destructive bg-destructive px-4 py-3 text-sm text-white shadow-lg"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">
          Background jobs are stopped: the sidecar is not running
        </p>
        <p className="text-white/90">
          Exports, renders and posts wait in the queue until it is back. It
          restarts on its own; if this stays, read the <code>pnpm dev</code> /{" "}
          <code>pnpm start</code> terminal (
          <code>.data/logs/dev-latest.log</code>).
        </p>
      </div>
    </div>
  );
}
