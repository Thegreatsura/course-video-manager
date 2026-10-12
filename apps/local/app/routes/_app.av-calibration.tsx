import { Effect } from "effect";
import { CalibrationHistory } from "@/features/av-calibration/calibration-history";
import { CalibrationSession } from "@/features/av-calibration/calibration-session";
import { LevelMeter } from "@/features/av-calibration/level-meter";
import { useAVCalibration } from "@/features/av-calibration/use-av-calibration";
import {
  lastPassedCalibration,
  listAVCalibrations,
} from "@/services/av-calibration.server";
import {
  calibrationExpiresAtMs,
  formatCalibrationTime,
  type LastPassedCalibration,
} from "@/av-calibration-constants";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";
import type { Route } from "./+types/_app.av-calibration";

export const meta: Route.MetaFunction = () => [
  { title: "CVM - AV Calibration" },
];

/**
 * The AV Calibration page (#2077). The level meter: the mic's loudness,
 * live, against the target band, so Matt sets his level by hand on the
 * Scarlett's gain knob or the Voicemeeter fader. Then the scripted session
 * (#2079), which measures the mic, sets the silence threshold and stores the
 * AV Calibration, passed or failed, and its review timeline (#2081),
 * which opens again for any past calibration. CVM only listens; it never changes a
 * Windows, OBS or Voicemeeter setting. Recording is gated on it (ADR 0038):
 * the page says when the last pass expires.
 */
export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const db = yield* DrizzleService;
      return {
        calibrations: yield* listAVCalibrations(db),
        lastPassed: yield* lastPassedCalibration(db),
        checkedAtMs: Date.now(),
      };
    }),
});

export default function AVCalibrationPage({
  loaderData,
}: Route.ComponentProps) {
  const [state, dispatch] = useAVCalibration();
  const { session } = state;
  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-4xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">AV Calibration</h1>
          <p className="text-muted-foreground">
            Talk as you would on camera, and set your level by hand, on the
            Scarlett&apos;s gain knob or the Voicemeeter fader, until the meter
            sits in the band. Then run the scripted session. CVM only listens:
            it never changes a Windows, OBS or Voicemeeter setting.
          </p>
        </div>
        <GateStatus
          lastPassed={loaderData.lastPassed}
          checkedAtMs={loaderData.checkedAtMs}
        />
        <CalibrationSession
          state={state}
          onStart={() => dispatch({ type: "start-clicked" })}
          onCancel={() => dispatch({ type: "cancel-clicked" })}
          onBackToMeter={() => dispatch({ type: "back-to-meter-clicked" })}
        />
        <LevelMeter
          state={state.meter}
          onTryAgain={() => dispatch({ type: "try-again-clicked" })}
        />
        <CalibrationHistory
          calibrations={loaderData.calibrations}
          openId={session.kind === "result" ? session.calibration.id : null}
          disabled={
            session.kind !== "meter" &&
            session.kind !== "result" &&
            session.kind !== "failed"
          }
          onOpen={(calibration) =>
            dispatch({ type: "past-calibration-clicked", calibration })
          }
        />
      </div>
    </div>
  );
}

/** When the last pass (under today's rules) expires, and so recording with it. */
const GateStatus = (props: {
  lastPassed: LastPassedCalibration | null;
  checkedAtMs: number;
}) => {
  if (!props.lastPassed)
    return (
      <p
        data-testid="calibration-gate-status"
        className="text-sm font-semibold text-amber-500"
      >
        No AV Calibration has passed under the current rules: recording is
        blocked on both Recorders until one does.
      </p>
    );
  const expiresAtMs = calibrationExpiresAtMs(props.lastPassed);
  const expired = props.checkedAtMs >= expiresAtMs;
  return (
    <p
      data-testid="calibration-gate-status"
      className={`text-sm ${expired ? "font-semibold text-amber-500" : "text-muted-foreground"}`}
    >
      Last passed {formatCalibrationTime(props.lastPassed.createdAtMs)}, on{" "}
      {props.lastPassed.cameraDevice} and {props.lastPassed.recorderMic}.{" "}
      {expired
        ? `It expired ${formatCalibrationTime(expiresAtMs)}: recording is blocked until one passes.`
        : `Recording is allowed until ${formatCalibrationTime(expiresAtMs)}, on the same camera and mic.`}
    </p>
  );
};
