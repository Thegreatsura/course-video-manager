import type { ScriptStep } from "@/av-calibration-constants";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { avCalibrationReducer } from "./av-calibration-reducer";
import type { CalibrationTimeline, TimelineSpan } from "./calibration-timeline";

/** Where `seconds` sits along the axis, as a CSS percentage. */
const at = (seconds: number, end: number) =>
  `${(Math.min(Math.max(seconds, 0), end) / end) * 100}%`;

const across = (start: number, end: number, axisEnd: number) => ({
  left: at(start, axisEnd),
  width: `calc(${at(end, axisEnd)} - ${at(start, axisEnd)})`,
});

const PROMPT_STYLE: Record<ScriptStep["kind"], string> = {
  countdown: "bg-muted",
  silence: "bg-sky-500/30",
  "clap-ready": "bg-violet-500/20",
  clap: "bg-violet-500/40",
  read: "bg-emerald-500/40",
  pause: "bg-amber-500/30",
  loud: "bg-red-500/40",
};

const promptLabel = (step: ScriptStep) => {
  switch (step.kind) {
    case "countdown":
      return "Get ready";
    case "silence":
      return "Stay quiet";
    case "clap-ready":
      return "Hands up";
    case "clap":
      return `Clap ${step.clap}`;
    case "read":
      return `Read ${step.line}`;
    case "pause":
      return `Pause ${step.line}`;
    case "loud":
      return "Loud";
  }
};

const Row = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-center gap-3">
    <div className="w-32 shrink-0 text-sm text-muted-foreground">{label}</div>
    <div className="relative h-8 flex-1 overflow-hidden rounded bg-muted/40">
      {children}
    </div>
  </div>
);

const PromptsRow = ({ timeline }: { timeline: CalibrationTimeline }) => (
  <Row label="Prompts">
    {timeline.prompts.map((step) => (
      <div
        key={`${step.kind}-${step.startSeconds}`}
        className={cn(
          "absolute inset-y-0 flex items-center overflow-hidden border-l border-background pl-3 text-[11px] font-medium whitespace-nowrap text-foreground/80",
          PROMPT_STYLE[step.kind]
        )}
        style={across(step.startSeconds, step.endSeconds, timeline.endSeconds)}
        title={`${promptLabel(step)}: ${step.startSeconds.toFixed(2)}–${step.endSeconds.toFixed(2)} s`}
      >
        {step.kind !== "countdown" && promptLabel(step)}
      </div>
    ))}
    {timeline.prompts
      .filter((step) => step.kind !== "countdown")
      .map((step) => (
        <div
          key={`margin-${step.startSeconds}`}
          aria-label="Reaction margin"
          className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,rgba(127,127,127,0.55)_0_2px,transparent_2px_5px)]"
          style={across(
            step.startSeconds,
            step.startSeconds + timeline.reactionMarginSeconds,
            timeline.endSeconds
          )}
        />
      ))}
  </Row>
);

const DetectorRow = ({
  label,
  spans,
  endSeconds,
}: {
  label: string;
  spans: TimelineSpan[];
  endSeconds: number;
}) => (
  <Row label={label}>
    {spans.map((span) => (
      <div
        key={span.startSeconds}
        className={cn(
          "absolute inset-y-0",
          span.kind === "speech" ? "bg-emerald-500" : "bg-transparent"
        )}
        style={across(span.startSeconds, span.endSeconds, endSeconds)}
        title={`${span.kind}: ${span.startSeconds.toFixed(2)}–${span.endSeconds.toFixed(2)} s`}
      />
    ))}
  </Row>
);

const Axis = ({ endSeconds }: { endSeconds: number }) => {
  const ticks = Array.from(
    { length: Math.floor(endSeconds / 5) + 1 },
    (_, i) => i * 5
  );
  return (
    <div className="flex gap-3">
      <div className="w-32 shrink-0" />
      <div className="relative h-4 flex-1 text-[10px] text-muted-foreground">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2 tabular-nums"
            style={{ left: at(t, endSeconds) }}
          >
            {t}s
          </span>
        ))}
      </div>
    </div>
  );
};

/**
 * An AV Calibration's review timeline (#2081): the prompts and the FFmpeg
 * detector on one axis, in seconds of the mic file.
 * For Matt to judge by eye; it decides nothing.
 */
export const CalibrationTimelineView = ({
  timeline: load,
}: {
  timeline: avCalibrationReducer.Timeline;
}) => {
  if (load.status === "loading")
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Drawing the timeline…
      </div>
    );
  if (load.status === "failed")
    return (
      <p className="text-sm text-amber-500">
        Could not draw the timeline: {load.message}
      </p>
    );
  const { timeline } = load;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <div className="font-semibold">Timeline</div>
        <div className="text-xs text-muted-foreground">
          The detector cuts at {timeline.rule.thresholdDb.toFixed(1)} dB,
          silences of {timeline.rule.minSilenceSeconds} s or more. Green is
          speech; hatching is the {timeline.reactionMarginSeconds} s reaction
          margin.
        </div>
      </div>
      <PromptsRow timeline={timeline} />
      <DetectorRow
        label="FFmpeg detector"
        spans={timeline.ffmpeg}
        endSeconds={timeline.endSeconds}
      />
      <Axis endSeconds={timeline.endSeconds} />
      <p className="text-xs text-muted-foreground">
        Review only: what the detector heard does not change pass or fail.
      </p>
    </div>
  );
};
