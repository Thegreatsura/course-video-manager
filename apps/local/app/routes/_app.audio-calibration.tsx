import { Effect } from "effect";
import { CalibrationHistory } from "@/features/audio-calibration/calibration-history";
import { CalibrationSession } from "@/features/audio-calibration/calibration-session";
import { LevelMeter } from "@/features/audio-calibration/level-meter";
import { useAudioCalibration } from "@/features/audio-calibration/use-audio-calibration";
import { listAudioCalibrations } from "@/services/audio-calibration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";
import type { Route } from "./+types/_app.audio-calibration";

export const meta: Route.MetaFunction = () => [
  { title: "CVM - Audio Calibration" },
];

/**
 * The Audio Calibration page (#2077). The level meter: the mic's loudness,
 * live, against the target band, so Matt sets his level by hand on the
 * Scarlett's gain knob or the Voicemeeter fader. Then the scripted session
 * (#2079), which measures the mic, sets the silence threshold and stores the
 * Audio Calibration, passed or failed, and its review timeline (#2081),
 * which opens again for any past calibration. CVM only listens; it never changes a
 * Windows, OBS or Voicemeeter setting.
 */
export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      return {
        calibrations: yield* listAudioCalibrations(yield* DrizzleService),
      };
    }),
});

export default function AudioCalibrationPage({
  loaderData,
}: Route.ComponentProps) {
  const [state, dispatch] = useAudioCalibration();
  const { session } = state;
  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-4xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Audio Calibration</h1>
          <p className="text-muted-foreground">
            Talk as you would on camera, and set your level by hand, on the
            Scarlett&apos;s gain knob or the Voicemeeter fader, until the meter
            sits in the band. Then run the scripted session. CVM only listens:
            it never changes a Windows, OBS or Voicemeeter setting.
          </p>
        </div>
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
