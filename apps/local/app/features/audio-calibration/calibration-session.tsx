import { Button } from "@/components/ui/button";
import {
  READ_SECONDS,
  PAUSE_SECONDS,
  SCRIPT_END_SECONDS,
  SCRIPT_LINES,
  SILENCE_SECONDS,
  TARGET_BAND,
  type ScriptStep,
} from "@/audio-calibration-constants";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import {
  currentStep,
  type audioCalibrationReducer,
} from "./audio-calibration-reducer";
import type { SavedAudioCalibration } from "./calibration-wire";

type State = audioCalibrationReducer.State;

const dB = (n: number) => `${n.toFixed(1)} dB`;

const PROMPT: Record<ScriptStep["kind"], string> = {
  countdown: "Get ready",
  silence: "Stay quiet",
  read: "Read line",
  pause: "Pause",
};

const PROMPT_STYLE: Record<ScriptStep["kind"], string> = {
  countdown: "text-muted-foreground",
  silence: "text-sky-400",
  read: "text-emerald-400",
  pause: "text-amber-400",
};

/** The step on screen during a run: the prompt, its countdown, the line to read. */
const Prompt = ({ state }: { state: State }) => {
  const now = currentStep(state);
  if (!now)
    return (
      <div className="flex items-center gap-3 text-2xl text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
        Starting the run…
      </div>
    );
  const { step, remainingSeconds } = now;
  const line = step.kind === "read" || step.kind === "pause" ? step.line : null;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-6">
        <div className={cn("text-4xl font-bold", PROMPT_STYLE[step.kind])}>
          {PROMPT[step.kind]}
          {step.kind === "read" && ` ${line}`}
        </div>
        <div className="font-mono tabular-nums text-6xl font-semibold">
          {Math.ceil(remainingSeconds)}
        </div>
      </div>
      <div className="min-h-[4.5rem] text-2xl leading-snug">
        {step.kind === "read" && <q>{SCRIPT_LINES[step.line - 1]}</q>}
        {step.kind === "pause" && (
          <span className="text-muted-foreground">
            {line === SCRIPT_LINES.length
              ? "Last pause: stay quiet."
              : `Next: line ${line! + 1}.`}
          </span>
        )}
        {step.kind === "silence" && (
          <span className="text-muted-foreground">
            Measuring the room. Keep still and say nothing.
          </span>
        )}
        {step.kind === "countdown" && (
          <span className="text-muted-foreground">
            {SILENCE_SECONDS} s of silence first.
          </span>
        )}
      </div>
    </div>
  );
};

/** How far through the script the run is. */
const Progress = ({ seconds }: { seconds: number }) => (
  <div className="h-1.5 rounded bg-muted overflow-hidden">
    <div
      className="h-full bg-emerald-500 transition-[width]"
      style={{
        width: `${Math.min(100, (seconds / SCRIPT_END_SECONDS) * 100)}%`,
      }}
    />
  </div>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-xs uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="font-mono tabular-nums text-2xl font-semibold">{value}</div>
  </div>
);

const Result = ({ calibration }: { calibration: SavedAudioCalibration }) => {
  const { judgement } = calibration;
  return (
    <div className="space-y-5">
      {judgement.outcome === "passed" ? (
        <div className="flex items-center gap-3 text-3xl font-bold text-emerald-500">
          <CheckCircle2 className="w-8 h-8" />
          Passed
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-3 text-3xl font-bold text-red-500">
            <XCircle className="w-8 h-8" />
            Failed: too {judgement.miss === "too-quiet"
              ? "quiet"
              : "loud"} by {dB(judgement.byDb)}
          </div>
          <p className="mt-1 text-muted-foreground">
            Turn your level {judgement.miss === "too-quiet" ? "up" : "down"}{" "}
            until the meter sits in the band, then run it again.
          </p>
        </div>
      )}
      <div className="grid grid-cols-3 gap-6">
        <Stat
          label="Speech loudness"
          value={`${calibration.speechLufs.toFixed(1)} LUFS`}
        />
        <Stat
          label="Noise floor"
          value={`${calibration.noiseFloorDb.toFixed(1)} dBFS`}
        />
        <Stat label="Silence threshold" value={dB(calibration.thresholdDb)} />
      </div>
      <p className="text-sm text-muted-foreground">
        Target band {TARGET_BAND.lowLufs} to {TARGET_BAND.highLufs} LUFS. Stored{" "}
        {new Date(calibration.createdAt).toLocaleString()}, on{" "}
        {calibration.recorderMic}
        {calibration.browserInputLabel
          ? `; browser input ${calibration.browserInputLabel}`
          : "; no browser input"}
        .
      </p>
    </div>
  );
};

/** What the browser detector is listening to during a run. */
const BrowserInput = ({ state }: { state: State }) => {
  const { label, problem } = state.browser;
  if (label)
    return (
      <p className="text-sm text-muted-foreground">
        Browser detector listening to {label}.
      </p>
    );
  if (problem)
    return (
      <p className="text-sm text-amber-500">
        No browser trace for this run: {problem}
      </p>
    );
  return null;
};

/**
 * The scripted session of an Audio Calibration: Start from the meter, the
 * prompts and their countdowns, then the result. Every decision is the
 * reducer's; this only draws it.
 */
export const CalibrationSession = ({
  state,
  onStart,
  onCancel,
  onBackToMeter,
}: {
  state: State;
  onStart: () => void;
  onCancel: () => void;
  onBackToMeter: () => void;
}) => {
  const session = state.session;
  return (
    <div className="rounded-lg border p-6 space-y-5">
      {session.kind === "meter" && (
        <div className="flex items-center justify-between gap-6">
          <div>
            <div className="text-xl font-semibold">
              Run the scripted session
            </div>
            <p className="text-muted-foreground">
              About {Math.round(SCRIPT_END_SECONDS)} s: {SILENCE_SECONDS} s of
              silence, then {SCRIPT_LINES.length} rounds of reading a line (
              {READ_SECONDS} s) and pausing ({PAUSE_SECONDS} s).
            </p>
          </div>
          <Button
            size="lg"
            onClick={onStart}
            disabled={state.meter.status !== "running"}
          >
            Start
          </Button>
        </div>
      )}

      {(session.kind === "starting" || session.kind === "running") && (
        <>
          <Prompt state={state} />
          <Progress
            seconds={session.kind === "running" ? session.seconds : 0}
          />
          <div className="flex items-center justify-between gap-6">
            <BrowserInput state={state} />
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {session.kind === "analysing" && (
        <div className="flex items-center gap-3 text-2xl text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          Measuring your mic…
        </div>
      )}

      {session.kind === "result" && (
        <>
          <Result calibration={session.calibration} />
          <Button
            variant={
              session.calibration.outcome === "passed" ? "outline" : "default"
            }
            onClick={onBackToMeter}
          >
            Back to the meter
          </Button>
        </>
      )}

      {session.kind === "failed" && (
        <div className="space-y-3">
          <div className="text-xl font-semibold text-red-500">
            The session stopped
          </div>
          <p className="text-sm">{session.message}</p>
          <Button onClick={onBackToMeter}>Back to the meter</Button>
        </div>
      )}
    </div>
  );
};
