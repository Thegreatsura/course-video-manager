import { AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { VideoWarning } from "@/services/video-warnings";
import { VIDEO_WARNING_LABELS } from "./video-warning-labels";

/**
 * The compact view's per-Video warning marker: a small amber triangle inline
 * after the Video's name, in the same style as the Lesson row's warning
 * marker. Hovering it lists the Video's warnings, one per line, in the plain
 * words from {@link VIDEO_WARNING_LABELS}. Renders nothing when the Video has
 * no warnings, when the course is read-only (an old version — nothing to
 * fix), or when the "Video warnings" display toggle is off.
 */
export function VideoWarningIndicator({
  warnings,
  isReadOnly,
  visible,
}: {
  warnings: readonly VideoWarning[];
  isReadOnly: boolean;
  visible: boolean;
}) {
  if (!visible || isReadOnly || warnings.length === 0) return null;
  const labels = warnings.map((w) => VIDEO_WARNING_LABELS[w.kind]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={`Video warnings: ${labels.join("; ")}`}
            className="inline-flex items-center rounded-sm bg-amber-500/15 p-0.5 text-amber-600 dark:text-amber-400 shrink-0"
          >
            <AlertTriangle className="w-3 h-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <ul>
            {labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
