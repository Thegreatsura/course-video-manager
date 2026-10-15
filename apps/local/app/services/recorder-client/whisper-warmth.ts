/**
 * THE RECORDER'S HOLD ON WHISPER (#2214). While the recorder is open (or
 * recording) the app server keeps Local Whisper loaded in the Sidecar, so a
 * transcription never cold-starts it on the GPU mid-take: once as it opens,
 * then every `WHISPER_WARM_RENEW_MS`. Each hold lasts `WHISPER_WARM_MS`, so
 * one missed renewal does not lapse it, and a dead app server pins no VRAM
 * for long.
 */

/** How often an open recorder renews its hold on Whisper. */
export const WHISPER_WARM_RENEW_MS = 60_000;
/** How long one hold lasts. */
export const WHISPER_WARM_MS = 3 * WHISPER_WARM_RENEW_MS;

/** `open`: whether the recorder is open (or recording) now. */
export const holdWhisperWarm = (
  keepWarm: ((ms: number) => void) | undefined,
  open: () => boolean
) => {
  const o = { keepWarm, open };
  let wasOpen = false;
  const timer = setInterval(() => {
    if (o.open()) o.keepWarm?.(WHISPER_WARM_MS);
  }, WHISPER_WARM_RENEW_MS);
  timer.unref();
  return {
    /** After every change of the recorder's state: holds it as it opens. */
    changed: () => {
      const open = o.open();
      if (open && !wasOpen) o.keepWarm?.(WHISPER_WARM_MS);
      wasOpen = open;
    },
    close: () => clearInterval(timer),
  };
};
