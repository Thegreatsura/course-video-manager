import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown when the Active Diagram's stored head changed elsewhere while the
 * canvas held unsaved edits. Neither side is overwritten until the author
 * picks one.
 */
export function HeadChangedElsewherePrompt({
  onLoadChanged,
  onKeepMine,
}: {
  onLoadChanged: () => void;
  onKeepMine: () => void;
}) {
  return (
    <div
      role="alert"
      className="absolute left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 shadow-lg"
    >
      <RefreshCw className="h-4 w-4 shrink-0 text-amber-400" />
      <span>This diagram changed elsewhere. Reload it?</span>
      <Button size="sm" onClick={onLoadChanged}>
        Reload, drop my edits
      </Button>
      <Button size="sm" variant="outline" onClick={onKeepMine}>
        Keep my edits
      </Button>
    </div>
  );
}
