import { LevelMeter } from "@/features/audio-calibration/level-meter";
import { useLevelMeter } from "@/features/audio-calibration/use-level-meter";
import type { Route } from "./+types/_app.audio-calibration";

export const meta: Route.MetaFunction = () => [
  { title: "CVM - Audio Calibration" },
];

/**
 * The Audio Calibration page (#2077). Its first step, the level meter: the
 * mic's loudness, live, against the target band, so Matt sets his level by
 * hand on the Scarlett's gain knob or the Voicemeeter fader. CVM only
 * listens; it never changes a Windows, OBS or Voicemeeter setting.
 */
export default function AudioCalibrationPage() {
  const [state, dispatch] = useLevelMeter();
  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Audio Calibration</h1>
        <p className="text-muted-foreground mb-8">
          Talk as you would on camera, and set your level by hand, on the
          Scarlett&apos;s gain knob or the Voicemeeter fader, until the meter
          sits in the band. CVM only listens: it never changes a Windows, OBS or
          Voicemeeter setting.
        </p>
        <LevelMeter
          state={state}
          onTryAgain={() => dispatch({ type: "try-again-clicked" })}
        />
      </div>
    </div>
  );
}
