import type { CaptureStatus } from "@/lib/teleprompter-protocol";
import type { OBSConnectionOuterState } from "./obs-connector";
import {
  isNewRecorderRecording,
  type newRecorderReducer,
} from "./new-recorder-reducer";
import type { FrontendSpeechDetectorState } from "./use-speech-detector";

/**
 * What a take is doing, whichever Recorder films it: whether it records, and
 * what silence detection hears. OBS reports both through the OBS connector
 * (its recording state and the browser speech detector); the New recorder
 * through `newRecorderReducer` (the recorder service's ffmpeg silencedetect),
 * in the same vocabulary. Everything downstream (the editor's badge, its
 * Silence Length toggle and the teleprompter) reads this, so none of it cares
 * which Recorder is in use.
 */
export type RecorderCapture = {
  isRecording: boolean;
  speech: FrontendSpeechDetectorState;
};

export const getRecorderCapture = (o: {
  usesObs: boolean;
  obsState: OBSConnectionOuterState;
  obsSpeech: FrontendSpeechDetectorState;
  newRecorder: newRecorderReducer.State;
}): RecorderCapture =>
  o.usesObs
    ? { isRecording: o.obsState.type === "obs-recording", speech: o.obsSpeech }
    : {
        isRecording: isNewRecorderRecording(o.newRecorder),
        speech: o.newRecorder.speech,
      };

/**
 * The editor's capture props, from the route's Recorder choice and its two
 * Recorders' connectors.
 */
export const captureProps = (
  choice: { usesObs: boolean },
  obs: {
    state: OBSConnectionOuterState;
    speechDetectorState: FrontendSpeechDetectorState;
  },
  newRecorder: { state: newRecorderReducer.State }
): {
  speechDetectorState: FrontendSpeechDetectorState;
  isRecordingActive: boolean;
} => {
  const capture = getRecorderCapture({
    usesObs: choice.usesObs,
    obsState: obs.state,
    obsSpeech: obs.speechDetectorState,
    newRecorder: newRecorder.state,
  });
  return {
    speechDetectorState: capture.speech,
    isRecordingActive: capture.isRecording,
  };
};

/** The capture status the teleprompter shows on the glass. */
export const toCaptureStatus = (capture: RecorderCapture): CaptureStatus =>
  capture.isRecording ? capture.speech.type : "not-recording";
