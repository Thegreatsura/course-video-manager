import { Button } from "@/components/ui/button";
import { CircleIcon, SquareIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { SilenceLengthToggle } from "./silence-length-toggle";

/** What the New recorder is doing, in a few words. */
const statusText = (
  controls: ReturnType<typeof useNewRecorderControls>
): string => {
  const { state } = controls;
  if (state.reachable === null) return "Connecting to the recorder…";
  if (!state.reachable) return "The recorder service is not running.";
  if (state.problem) return state.problem;
  switch (state.phase) {
    case "idle":
      return "Ready to record.";
    case "starting":
      return "Starting…";
    case "recording":
      return state.speaking ? "Recording · speaking" : "Recording";
    case "stopping":
      return "Stopping…";
  }
};

const useNewRecorderControls = () =>
  useContextSelector(VideoEditorContext, (ctx) => ctx.newRecorder);

/**
 * Record and Stop for a New recorder Video, with its Silence Length. Clips
 * appear in the timeline as the recorder hears each take end, already saved.
 */
export const NewRecorderControls = () => {
  const controls = useNewRecorderControls();
  const { state } = controls;
  return (
    <div className="mt-2 flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <SilenceLengthToggle />
        {state.phase === "recording" || state.phase === "stopping" ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!controls.canStop}
            onClick={controls.onStop}
          >
            <SquareIcon className="size-3.5 mr-1" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!controls.canRecord}
            onClick={controls.onRecord}
          >
            <CircleIcon className="size-3.5 mr-1 fill-current" />
            Record
          </Button>
        )}
        <span
          className="text-xs text-muted-foreground"
          data-testid="new-recorder-status"
        >
          {statusText(controls)}
        </span>
      </div>
      {state.error && (
        <p className="text-xs text-red-500 whitespace-pre-line text-center">
          {state.error}
        </p>
      )}
    </div>
  );
};
