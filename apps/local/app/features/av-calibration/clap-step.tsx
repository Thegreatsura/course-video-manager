import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, Play, Square } from "lucide-react";
import { frameMs } from "@/packages/clap-step";
import {
  clapStepOffsetMs,
  soundRange,
  videoRange,
  type avCalibrationReducer,
} from "./av-calibration-reducer";

type ClapStep = avCalibrationReducer.ClapStep;
type Action = avCalibrationReducer.Action;

const base = (calibrationId: string) =>
  `/api/av-calibration/${encodeURIComponent(calibrationId)}`;

/** The waveform as an SVG path: one vertical line per ms, centred. */
const waveformPath = (peaks: number[]) =>
  peaks.map((p, i) => `M${i} ${50 - p * 50}V${50 + p * 50}`).join("");

const Arrow = (props: {
  label: string;
  direction: -1 | 1;
  onClick: () => void;
}) => (
  <Button
    variant="outline"
    size="icon"
    aria-label={props.label}
    onClick={props.onClick}
  >
    {props.direction < 0 ? (
      <ChevronLeft className="w-4 h-4" />
    ) : (
      <ChevronRight className="w-4 h-4" />
    )}
  </Button>
);

/**
 * THE CLAP STEP (#2137): line up one clap by eye and ear. Slider 1 is the
 * clap in the sound, over the mic's waveform (1 ms steps); slider 2 the clap
 * in the picture, a large camera frame (one frame steps). The Mic Offset is
 * the gap between them, shown live; Play loops about 2 s around the clap
 * with it applied; Save stores it for new Recording Sessions. Every decision
 * is the reducer's; this only draws it.
 */
export const ClapStepView = ({
  calibrationId,
  step,
  dispatch,
}: {
  calibrationId: string;
  step: ClapStep;
  dispatch: (action: Action) => void;
}) => {
  if (step.status === "loading")
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading the clap step…
      </div>
    );
  if (step.status === "failed")
    return (
      <p className="text-sm text-red-500">
        The clap step could not load: {step.message}
      </p>
    );
  const sound = soundRange(step.data);
  const video = videoRange(step.data);
  const offsetMs = clapStepOffsetMs(step);
  const { peaks, startMs } = step.data.waveform;
  const handleAt =
    ((step.soundMs - sound.min) / Math.max(1, sound.max - sound.min)) * 100;
  const saving = step.save.status === "saving";
  return (
    <section className="space-y-5 rounded-lg border p-5" aria-label="Clap step">
      <div>
        <h2 className="text-xl font-semibold">Clap step</h2>
        <p className="text-sm text-muted-foreground">
          Line up one clap: put the sound handle where the clap starts, and the
          video slider on the frame the hands meet. Play to check by ear.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Sound</span>
          <span className="font-mono tabular-nums">
            {(step.soundMs / 1000).toFixed(3)} s
          </span>
        </div>
        <div className="relative h-24 rounded bg-muted">
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox={`0 0 ${Math.max(1, peaks.length)} 100`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              d={waveformPath(peaks)}
              stroke="currentColor"
              className="text-sky-400"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none"
            style={{ left: `${handleAt}%` }}
          />
          <input
            type="range"
            aria-label="Sound: the clap in the mic"
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
            min={sound.min}
            max={sound.max}
            step={1}
            value={step.soundMs}
            onChange={(e) =>
              dispatch({
                type: "sound-handle-dragged",
                ms: Number(e.target.value),
              })
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <Arrow
            label="Sound 1 ms earlier"
            direction={-1}
            onClick={() =>
              dispatch({ type: "sound-arrow-clicked", direction: -1 })
            }
          />
          <Arrow
            label="Sound 1 ms later"
            direction={1}
            onClick={() =>
              dispatch({ type: "sound-arrow-clicked", direction: 1 })
            }
          />
          <span className="text-xs text-muted-foreground">
            {startMs / 1000} s to {(sound.max / 1000).toFixed(3)} s
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Video</span>
          <span className="font-mono tabular-nums">
            frame {step.videoFrame} (
            {(frameMs(step.videoFrame) / 1000).toFixed(3)} s)
          </span>
        </div>
        {step.playing ? (
          <video
            key="play"
            className="w-full aspect-video rounded bg-black"
            src={`${base(calibrationId)}/preview?frame=${step.videoFrame}&micOffsetMs=${offsetMs}`}
            autoPlay
            loop
            playsInline
            aria-label="Play: the clap, looping, with the Mic Offset applied"
          />
        ) : (
          <img
            className="w-full aspect-video rounded bg-black object-contain"
            src={`${base(calibrationId)}/frame/${step.videoFrame}`}
            alt={`Camera frame ${step.videoFrame}`}
          />
        )}
        <input
          type="range"
          aria-label="Video: the frame the hands meet"
          className="w-full"
          min={video.min}
          max={video.max}
          step={1}
          value={step.videoFrame}
          onChange={(e) =>
            dispatch({
              type: "video-handle-dragged",
              frame: Number(e.target.value),
            })
          }
        />
        <div className="flex items-center gap-2">
          <Arrow
            label="Video one frame earlier"
            direction={-1}
            onClick={() =>
              dispatch({ type: "video-arrow-clicked", direction: -1 })
            }
          />
          <Arrow
            label="Video one frame later"
            direction={1}
            onClick={() =>
              dispatch({ type: "video-arrow-clicked", direction: 1 })
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Mic Offset
          </div>
          <div
            className="font-mono tabular-nums text-2xl font-semibold"
            data-testid="clap-step-offset"
          >
            {offsetMs} ms
          </div>
        </div>
        {step.playing ? (
          <Button
            variant="outline"
            onClick={() => dispatch({ type: "stop-clicked" })}
          >
            <Square className="w-4 h-4 mr-2" />
            Stop
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => dispatch({ type: "play-clicked" })}
          >
            <Play className="w-4 h-4 mr-2" />
            Play
          </Button>
        )}
        <Button
          disabled={saving}
          onClick={() => dispatch({ type: "save-mic-offset-clicked" })}
        >
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save
        </Button>
        {step.save.status === "saved" && (
          <span className="text-sm text-emerald-500">
            Saved {step.save.micOffsetMs} ms: new Recording Sessions start with
            it, and recording is unblocked.
          </span>
        )}
        {step.save.status === "failed" && (
          <span className="text-sm text-red-500">
            Not saved: {step.save.message}
          </span>
        )}
      </div>
    </section>
  );
};
