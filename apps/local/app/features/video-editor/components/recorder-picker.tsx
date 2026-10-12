import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VideoRecorder } from "@cvm/core/features/videos/recorder";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";

const LABELS: Record<VideoRecorder, string> = {
  obs: "OBS",
  cvm: "CVM recorder",
};

/**
 * Which Recorder opens next on this Video, and the choice between them at any
 * time but mid-capture. Its Clips keep the Recorders that filmed them (ADR
 * 0036). Not shown when there is no choice: a Short records with the CVM
 * recorder only (ADR 0037).
 */
export const RecorderPicker = () => {
  const picker = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.recorderPicker
  );

  if (picker.options.length < 2) return null;

  return (
    <div
      className="flex items-center gap-2 text-xs"
      title={
        picker.capturing
          ? "The Recorder cannot switch while capturing"
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
              disabled={picker.capturing && !isActive}
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
      {picker.error && <span className="text-red-500">{picker.error}</span>}
    </div>
  );
};
