import { MINIMUM_CLIP_LENGTH_SECONDS } from "@/silence-detection-constants";

/**
 * The OBS path's live speech detector: what the browser's silence scan
 * (`silence-scan.ts`) means for the take. Speech is what lies between one
 * silence's end and the next silence's start, as `parseSpeechFromFFmpeg` and
 * the CVM recorder's `speech-detector.ts` read silencedetect.
 *
 * - Before the first silence has ended it is warming up.
 * - Speech that has gone on for the minimum Clip length since the last
 *   silence ended is long enough for a Clip, and gets the id the bridge
 *   stamped on the event that said so.
 *
 * Times are the audio's own seconds, carried on the events.
 */
export namespace speechDetectorReducer {
  export type State =
    | { type: "warming-up" }
    | { type: "silence" }
    | {
        type: "speaking";
        silenceEndedAtSeconds: number;
        /** Set once the speech is long enough for a Clip. */
        soundDetectionId: string | null;
      };

  export type Action =
    | { type: "recording-started" }
    | { type: "silence-started"; heardAtSeconds: number }
    | { type: "silence-ended"; endSeconds: number }
    /** More audio was heard with no silence change: the audio clock moved on. */
    | { type: "audio-heard"; atSeconds: number; soundDetectionId: string };
}

export type FrontendSpeechDetectorState =
  | { type: "warming-up" }
  | { type: "speaking-detected" }
  | { type: "long-enough-speaking-for-clip-detected"; soundDetectionId: string }
  | { type: "silence" };

export const createInitialSpeechDetectorState =
  (): speechDetectorReducer.State => ({ type: "warming-up" });

export const speechDetectorReducer = (
  state: speechDetectorReducer.State,
  action: speechDetectorReducer.Action
): speechDetectorReducer.State => {
  switch (action.type) {
    case "recording-started":
      return createInitialSpeechDetectorState();
    case "silence-started":
      return state.type === "silence" ? state : { type: "silence" };
    case "silence-ended":
      return {
        type: "speaking",
        silenceEndedAtSeconds: action.endSeconds,
        soundDetectionId: null,
      };
    case "audio-heard":
      if (
        state.type === "speaking" &&
        state.soundDetectionId === null &&
        action.atSeconds - state.silenceEndedAtSeconds >
          MINIMUM_CLIP_LENGTH_SECONDS
      ) {
        return { ...state, soundDetectionId: action.soundDetectionId };
      }
      return state;
  }
};

/** Whether the detector is waiting for speech to become long enough: only then does the clock matter. */
export const isAwaitingLongEnoughSpeech = (
  state: speechDetectorReducer.State
): boolean => state.type === "speaking" && state.soundDetectionId === null;

export const toFrontendSpeechDetectorState = (
  state: speechDetectorReducer.State
): FrontendSpeechDetectorState => {
  switch (state.type) {
    case "warming-up":
      return { type: "warming-up" };
    case "silence":
      return { type: "silence" };
    case "speaking":
      return state.soundDetectionId
        ? {
            type: "long-enough-speaking-for-clip-detected",
            soundDetectionId: state.soundDetectionId,
          }
        : { type: "speaking-detected" };
  }
};
