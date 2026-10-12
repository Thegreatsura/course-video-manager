import { useEffectReducer } from "use-effect-reducer";
import {
  createInitialLevelMeterState,
  levelMeterReducer,
} from "./level-meter-reducer";
import {
  LEVEL_METER_MESSAGE_TYPES,
  type LevelMeterMessage,
} from "./level-meter-wire";

/**
 * The effect runner for `levelMeterReducer`: listens to
 * `GET /api/audio-calibration/meter` while the page is open. Closing the
 * stream (leaving the page) is what stops the meter.
 */
export const useLevelMeter = () =>
  useEffectReducer(levelMeterReducer, createInitialLevelMeterState, {
    "listen-to-meter": (_state, _effect, dispatch) => {
      const open = () => {
        const source = new EventSource("/api/audio-calibration/meter");
        for (const type of LEVEL_METER_MESSAGE_TYPES) {
          source.addEventListener(type, (event) => {
            dispatch(JSON.parse(event.data) as LevelMeterMessage);
          });
        }
        return source;
      };
      let source = open();
      // A page left for another keeps its stream open while the browser
      // holds it in the back/forward cache, and with it the mic: close it on
      // the way out, and listen again if the page comes back.
      const close = () => source.close();
      const reopen = (event: PageTransitionEvent) => {
        if (event.persisted) source = open();
      };
      window.addEventListener("pagehide", close);
      window.addEventListener("pageshow", reopen);
      return () => {
        window.removeEventListener("pagehide", close);
        window.removeEventListener("pageshow", reopen);
        source.close();
      };
    },
  });
