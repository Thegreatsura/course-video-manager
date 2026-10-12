import { Button } from "@/components/ui/button";
import {
  CircleIcon,
  RotateCcwIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { SCENES } from "@/packages/scene-layout";
import { SilenceLengthToggle } from "./silence-length-toggle";

/** What the CVM recorder is doing, in a few words. */
const statusText = (
  controls: ReturnType<typeof useCvmRecorderControls>
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
      return state.speech.type === "speaking-detected" ||
        state.speech.type === "long-enough-speaking-for-clip-detected"
        ? "Recording · speaking"
        : "Recording";
    case "stopping":
      return "Stopping…";
  }
};

const framesText = (count: number, picture: string) =>
  `${count} ${picture} ${count === 1 ? "frame" : "frames"}`;

const useCvmRecorderControls = () =>
  useContextSelector(VideoEditorContext, (ctx) => ctx.cvmRecorder);

/** Camera, Code and No Face: the one lit is the scene the recorder is in. */
const SceneButtons = () => {
  const controls = useCvmRecorderControls();
  return (
    <div className="flex items-center gap-1" data-testid="cvm-recorder-scenes">
      {SCENES.map((scene) => (
        <Button
          key={scene}
          type="button"
          size="sm"
          variant={controls.state.scene === scene ? "default" : "outline"}
          aria-pressed={controls.state.scene === scene}
          disabled={!controls.canSwitchScene}
          onClick={() => controls.onScene(scene)}
        >
          {scene}
        </Button>
      ))}
    </div>
  );
};

/** The replug and Close-OBS messages, with Retry. */
const CameraProblem = () => {
  const controls = useCvmRecorderControls();
  const { camera } = controls.state;
  if (camera.kind !== "not-starting" && camera.kind !== "busy") return null;
  return (
    <div
      className="flex items-center gap-2 text-sm text-amber-500"
      data-testid="cvm-recorder-camera-problem"
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
 * Record and Stop for a CVM recorder Video, with its Silence Length and the
 * scene buttons, under the live frame (`LivePreviewFrame`), which draws the
 * composite. Clips appear in the timeline as the recorder hears each take
 * end, already saved.
 */
export const CvmRecorderControls = () => {
  const controls = useCvmRecorderControls();
  const { state } = controls;
  return (
    <div className="mt-2 flex flex-col items-center gap-2">
      {state.alert && (
        <div
          role="alert"
          data-testid="cvm-recorder-alert"
          className="flex w-full max-w-xl items-start gap-3 rounded-md border-2 border-red-600 bg-red-600/10 p-3 text-sm font-semibold text-red-700 dark:text-red-200"
        >
          <TriangleAlertIcon className="size-5 shrink-0 text-red-500" />
          <p className="flex-1">{state.alert}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={controls.onDismissAlert}
          >
            Dismiss
          </Button>
        </div>
      )}
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
          data-testid="cvm-recorder-status"
        >
          {statusText(controls)}
        </span>
      </div>
      <SceneButtons />
      <CameraProblem />
      {state.framesLost && (
        <p
          className={`text-xs ${state.framesLost.camera + (state.framesLost.screen ?? 0) > 0 ? "text-amber-500" : "text-muted-foreground"}`}
          data-testid="cvm-recorder-frames-lost"
        >
          Last recording:{" "}
          {state.framesLost.screen === null
            ? `${framesText(state.framesLost.camera, "camera")} lost (screen not measured)`
            : `${framesText(state.framesLost.camera, "camera")}, ${framesText(state.framesLost.screen, "screen")} lost`}
        </p>
      )}
      {state.error && (
        <p className="text-xs text-red-500 whitespace-pre-line text-center">
          {state.error}
        </p>
      )}
    </div>
  );
};
