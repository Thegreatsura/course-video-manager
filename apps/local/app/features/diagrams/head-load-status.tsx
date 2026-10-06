import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeadStatus } from "./head-autosaver";

/**
 * What the canvas shows while its head is not loaded — the canvas itself is
 * read-only then, so this says why and, on failure, offers the way out.
 */
export function HeadLoadStatus({
  status,
  onRetry,
}: {
  status: HeadStatus;
  onRetry: () => void;
}) {
  switch (status) {
    case "ready":
      return null;
    case "loading":
      return (
        <div className="pointer-events-none absolute left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-800/90 px-3 py-1.5 text-xs text-zinc-300 shadow">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading diagram…
        </div>
      );
    case "failed":
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
              Editing is off until it does, so nothing you draw can overwrite
              the saved diagram.
            </p>
            <Button size="sm" onClick={onRetry}>
              <RotateCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        </div>
      );
  }
}
