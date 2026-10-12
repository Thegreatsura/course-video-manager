import { useEffect, useMemo, useReducer, useRef } from "react";
import { silenceRule, type SilenceLength } from "@/silence-detection-constants";
import { createSilenceScanState, scanForSilence } from "./silence-scan";
import {
  createInitialSpeechDetectorState,
  isAwaitingLongEnoughSpeech,
  speechDetectorReducer,
  toFrontendSpeechDetectorState,
  type FrontendSpeechDetectorState,
} from "./speech-detector-reducer";

export type { FrontendSpeechDetectorState };

/**
 * The OBS path's live speech detector. The mic stream is the Recorders' own
 * mic, opened raw (`useConnectToOBSVirtualCamera`); every channel goes through
 * the silencedetect-equivalent scan, and what it hears is dispatched to
 * `speechDetectorReducer` as facts. This hook only bridges the Web Audio API.
 */
export const useSpeechDetector = (opts: {
  mediaStream: MediaStream | null;
  isRecording: boolean;
  silenceLength: SilenceLength;
}) => {
  const [state, dispatch] = useReducer(
    speechDetectorReducer,
    undefined,
    createInitialSpeechDetectorState
  );

  // Read from the audio callback, which outlives a render.
  const awaitingLongEnoughSpeech = useRef(false);
  awaitingLongEnoughSpeech.current = isAwaitingLongEnoughSpeech(state);

  useEffect(() => {
    if (opts.isRecording) dispatch({ type: "recording-started" });
  }, [opts.isRecording]);

  useEffect(() => {
    const track = opts.mediaStream?.getAudioTracks()[0];
    if (!opts.mediaStream || !track) return;

    const rule = silenceRule(opts.silenceLength);
    const channelCount = track.getSettings().channelCount ?? 2;
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(opts.mediaStream);
    const processor = audioContext.createScriptProcessor(1024, channelCount, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    let scan = createSilenceScanState();
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer;
      const channels = Array.from({ length: input.numberOfChannels }, (_, c) =>
        input.getChannelData(c)
      );
      const result = scanForSilence(scan, channels, rule, input.sampleRate);
      scan = result.state;
      for (const event of result.events) {
        dispatch(
          event.type === "silence-started"
            ? { type: "silence-started", heardAtSeconds: event.heardAtSeconds }
            : { type: "silence-ended", endSeconds: event.endSeconds }
        );
      }
      if (awaitingLongEnoughSpeech.current) {
        dispatch({
          type: "audio-heard",
          atSeconds: scan.frames / input.sampleRate,
          soundDetectionId: crypto.randomUUID(),
        });
      }
    };

    return () => {
      source.disconnect();
      processor.disconnect();
      void audioContext.close();
    };
  }, [opts.mediaStream, opts.silenceLength]);

  return useMemo(() => toFrontendSpeechDetectorState(state), [state]);
};

export const useWatchForSpeechDetected = (opts: {
  state: FrontendSpeechDetectorState;
  onSpeechPartStarted: (soundDetectionId: string) => void;
}) => {
  const prevState = useRef<FrontendSpeechDetectorState>(opts.state);
  useEffect(() => {
    if (
      prevState.current.type === "speaking-detected" &&
      opts.state.type === "long-enough-speaking-for-clip-detected"
    ) {
      opts.onSpeechPartStarted(opts.state.soundDetectionId);
    }
    prevState.current = opts.state;
  }, [opts.state, opts.onSpeechPartStarted]);
};

export const useWatchForSilenceDetected = (opts: {
  state: FrontendSpeechDetectorState;
  onSilenceDetected: () => void;
}) => {
  const prevState = useRef<FrontendSpeechDetectorState>(opts.state);
  useEffect(() => {
    if (prevState.current.type !== "silence" && opts.state.type === "silence") {
      opts.onSilenceDetected();
    }
    prevState.current = opts.state;
  }, [opts.state, opts.onSilenceDetected]);
};
