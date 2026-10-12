import { useEffectReducer } from "use-effect-reducer";
import { isMicDevice, MIC_NAME } from "@/mic-device";
import {
  audioCalibrationReducer,
  createInitialAudioCalibrationState,
} from "./audio-calibration-reducer";
import type { SavedAudioCalibration } from "./calibration-wire";
import { listenToMeter } from "./use-level-meter";

const post = async (url: string, body: unknown = {}) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") message = parsed;
    } catch {
      // Plain text.
    }
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return response;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** How often the browser trace is handed to the reducer, in ms. */
const TRACE_BATCH_MS = 250;
/** The browser detector's block: 1024 samples, as `use-speech-detector.ts`. */
const BLOCK_FRAMES = 1024;

/**
 * The browser detector's input, as the OBS path opens it: the Recorders' mic
 * by label, Chrome's processing off, every channel. Reports each block's peak
 * across the channels, in dBFS, a few times a second.
 */
const captureBrowserLevels = (
  dispatch: (action: audioCalibrationReducer.Action) => void
) => {
  let stopped = false;
  let cleanup = () => {};
  void (async () => {
    let devices = await navigator.mediaDevices.enumerateDevices();
    // Labels come only once the page may use a mic.
    if (devices.every((d) => d.kind !== "audioinput" || !d.label)) {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    const mic = devices.find(
      (d) => d.kind === "audioinput" && isMicDevice(d.label)
    );
    if (!mic)
      throw new Error(
        `${MIC_NAME} is not among the browser's audio inputs. Found: ${
          devices
            .filter((d) => d.kind === "audioinput")
            .map((d) => d.label)
            .join(", ") || "none"
        }`
      );
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: mic.deviceId },
        autoGainControl: false,
        noiseSuppression: false,
        echoCancellation: false,
        channelCount: 2,
      },
    });
    const track = stream.getAudioTracks()[0];
    if (stopped || !track) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    dispatch({ type: "browser-input-opened", label: track.label });
    const channelCount = track.getSettings().channelCount ?? 2;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(
      BLOCK_FRAMES,
      channelCount,
      1
    );
    source.connect(processor);
    processor.connect(context.destination);
    let peaks: number[] = [];
    let firstBlockEndedAtMs: number | undefined;
    let sent = 0;
    processor.onaudioprocess = (e) => {
      firstBlockEndedAtMs ??= Date.now();
      let peak = 0;
      for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) {
        for (const x of e.inputBuffer.getChannelData(c))
          peak = Math.max(peak, Math.abs(x));
      }
      peaks.push(peak > 0 ? 20 * Math.log10(peak) : -120);
    };
    const timer = setInterval(() => {
      if (peaks.length === 0 || firstBlockEndedAtMs === undefined) return;
      dispatch({
        type: "browser-levels-heard",
        firstBlockEndedAtMs,
        firstBlock: sent,
        blockSeconds: BLOCK_FRAMES / context.sampleRate,
        peaksDb: peaks,
      });
      sent += peaks.length;
      peaks = [];
    }, TRACE_BATCH_MS);
    cleanup = () => {
      clearInterval(timer);
      source.disconnect();
      processor.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
    };
    if (stopped) cleanup();
  })().catch((error: unknown) =>
    dispatch({ type: "browser-input-failed", message: messageOf(error) })
  );
  return () => {
    stopped = true;
    cleanup();
  };
};

/** The effect runner for `audioCalibrationReducer`. */
export const useAudioCalibration = () =>
  useEffectReducer(
    audioCalibrationReducer,
    createInitialAudioCalibrationState,
    {
      "listen-to-meter": (_state, _effect, dispatch) => listenToMeter(dispatch),
      "start-calibration": (_state, _effect, dispatch) => {
        post("/api/audio-calibration/start").catch((error: unknown) =>
          dispatch({ type: "start-refused", message: messageOf(error) })
        );
      },
      "cancel-calibration": () => {
        post("/api/audio-calibration/cancel").catch((error: unknown) =>
          console.error("Could not cancel the Audio Calibration", error)
        );
      },
      "finish-calibration": (_state, effect, dispatch) => {
        const { calibrationId, browserInputLabel, browserTrace } = effect;
        post("/api/audio-calibration/finish", {
          calibrationId,
          browserInputLabel,
          browserTrace,
        })
          .then(async (response) =>
            dispatch({
              type: "calibration-saved",
              calibrationId,
              calibration: (await response.json()) as SavedAudioCalibration,
            })
          )
          .catch((error: unknown) =>
            dispatch({
              type: "calibration-not-saved",
              calibrationId,
              message: messageOf(error),
            })
          );
      },
      "capture-browser-levels": (_state, _effect, dispatch) =>
        captureBrowserLevels(dispatch),
    }
  );
