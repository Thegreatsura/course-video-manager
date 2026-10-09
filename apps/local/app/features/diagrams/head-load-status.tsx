import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeadStatus, StatusError } from "./diagram-playground-reducer";
import { HeadChangedElsewherePrompt } from "./head-changed-elsewhere-prompt";

/**
 * The Active Diagram page's status area: everything the page has to tell the
 * author, in one place. A head that failed to load covers the canvas, since
 * the canvas is read-only then; the rest stacks at the top centre — the
 * loading pill, the "changed elsewhere" prompt, and the status line with the
 * page's latest error. Toasts are off on this page, so the status line is
 * where every error shows.
 */
export function PlaygroundStatusArea({
  status,
  onRetry,
  changedElsewhere,
  onLoadChanged,
  onKeepMine,
  error,
}: {
  /** `null` on a page with no diagram open: only the status line shows. */
  status: HeadStatus | null;
  onRetry: () => void;
  changedElsewhere: boolean;
  onLoadChanged: () => void;
  onKeepMine: () => void;
  error: StatusError | null;
}) {
  return (
    <>
      {status === "failed" && <HeadLoadFailed onRetry={onRetry} />}
      {/* Above the command palette's dialog, so a palette error shows too. */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {status === "loading" && (
          <div className="flex items-center gap-2 rounded-full bg-zinc-800/90 px-3 py-1.5 text-xs text-zinc-300 shadow">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading diagram…
          </div>
        )}
        {status !== null && changedElsewhere && (
          <div className="pointer-events-auto">
            <HeadChangedElsewherePrompt
              onLoadChanged={onLoadChanged}
              onKeepMine={onKeepMine}
            />
          </div>
        )}
        {error && <StatusLine key={error.id} message={error.message} />}
      </div>
    </>
  );
}

function StatusLine({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="playground-status-line"
      className="flex max-w-md items-center gap-2 rounded-lg border border-red-900 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 shadow-lg"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
      <span>{message}</span>
    </div>
  );
}

function HeadLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/60">
      <div
        role="alert"
        className="flex max-w-sm flex-col items-center gap-3 rounded-lg border border-red-900 bg-zinc-900 p-6 text-center shadow-lg"
      >
        <AlertTriangle className="h-6 w-6 text-red-400" />
        <div className="text-sm font-semibold text-zinc-100">
          This diagram didn't load
        </div>
        <p className="text-xs text-zinc-400">
          Editing is off until it does, so nothing you draw can overwrite the
          saved diagram.
        </p>
        <Button size="sm" onClick={onRetry}>
          <RotateCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    </div>
  );
}
