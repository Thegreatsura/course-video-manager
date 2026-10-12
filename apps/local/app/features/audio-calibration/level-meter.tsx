import { Button } from "@/components/ui/button";
import {
  TARGET_BAND,
  TARGET_LOUDNESS_LUFS,
  TARGET_TOLERANCE_DB,
} from "@/audio-calibration-constants";
import { cn } from "@/lib/utils";
import { Mic } from "lucide-react";
import {
  meterVerdict,
  SILENT_BELOW_LUFS,
  type levelMeterReducer,
} from "./level-meter-reducer";

/** The meter's scale, in LUFS: wide enough to show a 20 dB drift either way. */
const SCALE = { min: -50, max: -5 } as const;
const TICKS = [-50, -45, -40, -35, -30, -25, -20, -15, -10, -5];

/** A loudness as a percentage across the scale, clamped to it. */
const at = (lufs: number) =>
  (Math.min(Math.max(lufs, SCALE.min), SCALE.max) - SCALE.min) /
  ((SCALE.max - SCALE.min) / 100);

const dB = (n: number) => `${n.toFixed(1)} dB`;

const VERDICT_STYLE = {
  below: { bar: "bg-amber-500", text: "text-amber-500" },
  inside: { bar: "bg-emerald-500", text: "text-emerald-500" },
  above: { bar: "bg-red-500", text: "text-red-500" },
  silent: { bar: "bg-muted-foreground", text: "text-muted-foreground" },
} as const;

const Headline = ({ state }: { state: levelMeterReducer.State }) => {
  const verdict = meterVerdict(state);
  if (state.status === "failed")
    return (
      <div className="text-2xl font-semibold text-red-500">
        The meter is not running
      </div>
    );
  if (!verdict)
    return (
      <div className="text-2xl font-semibold text-muted-foreground">
        Starting the meter…
      </div>
    );
  const style = VERDICT_STYLE[verdict.position].text;
  switch (verdict.position) {
    case "silent":
      return (
        <div className={cn("text-2xl font-semibold", style)}>
          No sound from the mic
        </div>
      );
    case "below":
      return (
        <div>
          <div className={cn("text-2xl font-semibold", style)}>
            Below the band by {dB(verdict.byDb)}
          </div>
          <div className="text-muted-foreground">Turn your level up.</div>
        </div>
      );
    case "above":
      return (
        <div>
          <div className={cn("text-2xl font-semibold", style)}>
            Above the band by {dB(verdict.byDb)}
          </div>
          <div className="text-muted-foreground">Turn your level down.</div>
        </div>
      );
    case "inside":
      return (
        <div>
          <div className={cn("text-2xl font-semibold", style)}>
            Inside the band
          </div>
          <div className="text-muted-foreground">
            {verdict.byDb === 0
              ? "On the target."
              : `${dB(Math.abs(verdict.byDb))} ${verdict.byDb < 0 ? "under" : "over"} the ${TARGET_LOUDNESS_LUFS} LUFS target.`}
          </div>
        </div>
      );
  }
};

/**
 * The level meter: the short-term loudness as a bar, the momentary as a
 * tick, and the target band drawn across them.
 */
export const LevelMeter = ({
  state,
  onTryAgain,
}: {
  state: levelMeterReducer.State;
  onTryAgain: () => void;
}) => {
  const verdict = meterVerdict(state);
  const reading = state.reading;
  const bar = VERDICT_STYLE[verdict?.position ?? "silent"].bar;
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-6">
        <Headline state={state} />
        <div className="text-right font-mono tabular-nums">
          <div className="text-4xl font-semibold">
            {verdict && verdict.position !== "silent"
              ? verdict.lufs.toFixed(1)
              : "—"}
            <span className="text-base text-muted-foreground"> LUFS</span>
          </div>
          <div className="text-xs text-muted-foreground">
            short-term (3 s)
            {reading &&
              ` · momentary ${reading.momentaryLufs < SILENT_BELOW_LUFS ? "—" : reading.momentaryLufs.toFixed(1)}`}
          </div>
        </div>
      </div>

      <div>
        <div
          className="relative h-16 rounded-md border bg-muted/40 overflow-hidden"
          role="meter"
          aria-label="Mic loudness, short-term"
          aria-valuemin={SCALE.min}
          aria-valuemax={SCALE.max}
          aria-valuenow={reading?.shortTermLufs}
        >
          <div
            className={cn("absolute inset-y-0 left-0 transition-[width]", bar)}
            style={{
              width: `${reading ? at(reading.shortTermLufs) : 0}%`,
              opacity: 0.7,
            }}
          />
          <div
            className="absolute inset-y-0 border-x-2 border-emerald-400 bg-emerald-400/25"
            style={{
              left: `${at(TARGET_BAND.lowLufs)}%`,
              width: `${at(TARGET_BAND.highLufs) - at(TARGET_BAND.lowLufs)}%`,
            }}
          />
          <div
            className="absolute inset-y-0 border-l border-dashed border-emerald-200"
            style={{ left: `${at(TARGET_LOUDNESS_LUFS)}%` }}
          />
          {reading && (
            <div
              className="absolute inset-y-1 w-1 rounded bg-foreground"
              style={{ left: `calc(${at(reading.momentaryLufs)}% - 2px)` }}
              title="Momentary (400 ms)"
            />
          )}
        </div>
        <div className="relative h-5 text-xs text-muted-foreground font-mono">
          {TICKS.map((tick) => (
            <span
              key={tick}
              className="absolute -translate-x-1/2 top-1"
              style={{ left: `${at(tick)}%` }}
            >
              {tick}
            </span>
          ))}
        </div>
        <div className="mt-2 text-sm text-emerald-500">
          Target band: {TARGET_LOUDNESS_LUFS} LUFS ± {TARGET_TOLERANCE_DB} (
          {TARGET_BAND.lowLufs} to {TARGET_BAND.highLufs})
        </div>
      </div>

      {state.status === "failed" && state.failure && (
        <div className="rounded-md border border-red-500/50 bg-red-500/10 p-4 space-y-3">
          <p className="text-sm">{state.failure}</p>
          <Button variant="outline" size="sm" onClick={onTryAgain}>
            Try again
          </Button>
        </div>
      )}

      {state.mic && state.status !== "failed" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mic className="w-4 h-4" />
          Listening to {state.mic}, raw (before the Mic EQ), as the CVM recorder
          records it.
        </p>
      )}
    </div>
  );
};
