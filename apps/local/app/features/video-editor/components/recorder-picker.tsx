import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VideoRecorder } from "@cvm/core/features/videos/recorder";
import { LockIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";

const LABELS: Record<VideoRecorder, string> = {
  obs: "OBS",
  cvm: "CVM recorder",
};

/**
 * Which Recorder this Video records with, and the choice between them while
 * the Video has no Clips.
 */
export const RecorderPicker = () => {
  const picker = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.recorderPicker
  );

  return (
    <div
      className="flex items-center gap-2 text-xs"
      title={
        picker.locked
          ? "The Recorder is locked once the Video has Clips"
          : undefined
      }
    >
      <span className="text-muted-foreground">Recorder:</span>
      <div className="inline-flex rounded-md border bg-card p-0.5">
        {picker.options.map((recorder) => {
          const isActive = picker.recorder === recorder;
          return (
            <Button
              key={recorder}
              type="button"
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={isActive}
              disabled={picker.locked && !isActive}
              onClick={() => picker.onPick(recorder)}
              className={cn(
                "h-6 px-2 text-xs",
                !isActive && "text-muted-foreground"
              )}
            >
              {LABELS[recorder]}
            </Button>
          );
        })}
      </div>
      {picker.locked && picker.options.length > 1 && (
        <LockIcon className="size-3 text-muted-foreground" />
      )}
      {picker.error && <span className="text-red-500">{picker.error}</span>}
    </div>
  );
};
