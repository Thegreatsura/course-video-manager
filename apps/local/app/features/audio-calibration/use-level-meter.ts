import {
  LEVEL_METER_MESSAGE_TYPES,
  type LevelMeterMessage,
} from "./level-meter-wire";
import type { levelMeterReducer } from "./level-meter-reducer";

/**
 * The `listen-to-meter` effect: listens to `GET /api/audio-calibration/meter`
 * while the page is open. Closing the stream (leaving the page) is what stops
 * the meter. A reading is stamped with when the page heard it.
 */
export const listenToMeter = (
  dispatch: (action: levelMeterReducer.Action) => void
) => {
  const open = () => {
    const source = new EventSource("/api/audio-calibration/meter");
    for (const type of LEVEL_METER_MESSAGE_TYPES) {
      source.addEventListener(type, (event) => {
        const message = JSON.parse(event.data) as LevelMeterMessage;
        dispatch(
          message.type === "meter-reading"
            ? { ...message, receivedAtMs: Date.now() }
            : message
        );
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
};
