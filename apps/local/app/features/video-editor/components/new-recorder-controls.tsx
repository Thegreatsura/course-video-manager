import { Button } from "@/components/ui/button";
import { CircleIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
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
      switch (state.camera.kind) {
        case "closed":
          return "Opening the recorder…";
        case "opening":
          return state.camera.attempt > 1
            ? `Opening the Cam Link (try ${state.camera.attempt})…`
            : "Opening the Cam Link…";
        case "not-starting":
        case "busy":
          return "The Cam Link is not live.";
        case "live":
          return "Ready to record.";
      }
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
 * The raw camera and screen, straight from the recorder service (MJPEG in an
 * `<img>`). The camera shows once it is live or recording; the composite
 * comes with scenes.
 */
const RawPreviews = () => {
  const controls = useNewRecorderControls();
  const { state } = controls;
  const previews = state.previews;
  if (!previews || !state.reachable) return null;
  const cameraShowing = state.camera.kind === "live" || state.phase !== "idle";
  return (
    <div
      className="grid w-full grid-cols-2 gap-2"
      data-testid="new-recorder-previews"
    >
      {(["camera", "screen"] as const).map((feed) => (
        <div
          key={feed}
          className="aspect-[16/9] overflow-hidden rounded bg-black flex items-center justify-center"
        >
          {feed === "camera" && !cameraShowing ? (
            <span className="text-xs text-muted-foreground">No camera yet</span>
          ) : (
            <img
              // A new key when the camera comes back reconnects its stream.
              key={`${feed}-${state.camera.kind}`}
              src={previews[feed]}
              alt={`Raw ${feed} preview`}
              className="h-full w-full object-contain"
            />
          )}
        </div>
      ))}
    </div>
  );
};

/** The replug and Close-OBS messages, with Retry. */
const CameraProblem = () => {
  const controls = useNewRecorderControls();
  const { camera } = controls.state;
  if (camera.kind !== "not-starting" && camera.kind !== "busy") return null;
  return (
    <div
      className="flex items-center gap-2 text-sm text-amber-500"
      data-testid="new-recorder-camera-problem"
    >
      <span>{camera.message}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!controls.canRetryCamera}
        onClick={controls.onRetryCamera}
      >
        <RotateCcwIcon className="size-3.5 mr-1" />
        Retry
      </Button>
    </div>
  );
};

/**
 * Record and Stop for a New recorder Video, with its Silence Length, and the
 * raw previews. Clips appear in the timeline as the recorder hears each take
 * end, already saved.
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
      <CameraProblem />
      {state.error && (
        <p className="text-xs text-red-500 whitespace-pre-line text-center">
          {state.error}
        </p>
      )}
      <RawPreviews />
    </div>
  );
};
