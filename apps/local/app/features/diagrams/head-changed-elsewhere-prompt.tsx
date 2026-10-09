import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown when the Active Diagram's stored head changed elsewhere while the
 * canvas held unsaved edits. Neither side is overwritten until the author
 * picks one. Placed by `PlaygroundStatusArea`.
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
      className="flex items-center gap-3 rounded-lg border border-amber-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 shadow-lg"
    >
      <RefreshCw className="h-4 w-4 shrink-0 text-amber-400" />
      <span>This diagram changed elsewhere. Reload it?</span>
      <Button size="sm" onClick={onLoadChanged}>
        Reload, drop my edits
      </Button>
      <Button size="sm" variant="secondary" onClick={onKeepMine}>
        Keep my edits
      </Button>
    </div>
  );
}
