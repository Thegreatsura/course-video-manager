import {
  clapStepMicOffsetMs,
  frameAtMs,
  startingVideoFrame,
  type ClapStepData,
} from "@/packages/clap-step";

/**
 * THE CLAP STEP's sliders and Play (#2137), inside the AV Calibration page's
 * reducer (`av-calibration-reducer.ts`, which loads and saves it).
 */
export namespace clapStepReducer {
  /** The clap step: Matt lines up one clap by eye and ear, then saves its Mic Offset. */
  export type ClapStep =
    { status: "loading" } | { status: "failed"; message: string } | Ready;

  export type Ready = {
    status: "ready";
    data: ClapStepData;
    /** Slider 1: the clap in the sound, in ms of the mic file. */
    soundMs: number;
    /** Slider 2: the clap in the picture, a camera frame. */
    videoFrame: number;
    /** Play: looping the clip around the clap, the offset applied. */
    playing: boolean;
    save:
      | { status: "idle" }
      | { status: "saving"; micOffsetMs: number }
      | { status: "saved"; micOffsetMs: number }
      | { status: "failed"; message: string };
  };

  export type Action =
    /** Slider 1 dragged to `ms`, or stepped 1 ms by an arrow. */
    | { type: "sound-handle-dragged"; ms: number }
    | { type: "sound-arrow-clicked"; direction: -1 | 1 }
    /** Slider 2 dragged to `frame`, or stepped one frame by an arrow. */
    | { type: "video-handle-dragged"; frame: number }
    | { type: "video-arrow-clicked"; direction: -1 | 1 }
    | { type: "play-clicked" }
    | { type: "stop-clicked" };
}

type Ready = clapStepReducer.Ready;

/** The sound slider's range, in ms: the waveform's. */
export const soundRange = (data: ClapStepData) => ({
  min: data.waveform.startMs,
  max: data.waveform.startMs + Math.max(0, data.waveform.peaks.length - 1),
});

/** The video slider's range, in frames: the same stretch of time. */
export const videoRange = (data: ClapStepData) => {
  const sound = soundRange(data);
  return { min: frameAtMs(sound.min), max: frameAtMs(sound.max) };
};

const clamp = (n: number, r: { min: number; max: number }) =>
  Math.min(Math.max(n, r.min), r.max);

/** The Mic Offset the clap step's sliders say now. */
export const clapStepOffsetMs = (step: Ready) =>
  clapStepMicOffsetMs(step.soundMs, step.videoFrame);

/**
 * A loaded clap step: the sound at the loudest point, the video at that
 * time shifted by the current Mic Offset.
 */
export const startingClapStep = (data: ClapStepData): Ready => ({
  status: "ready",
  data,
  soundMs: data.loudestMs,
  videoFrame: clamp(
    startingVideoFrame(data.loudestMs, data.micOffsetMs),
    videoRange(data)
  ),
  playing: false,
  save: { status: "idle" },
});

/** Moves the sliders, within the window; a move makes a saved offset unsaved. */
const move = (step: Ready, soundMs: number, videoFrame: number): Ready => {
  if (step.save.status === "saving") return step;
  const sound = clamp(Math.round(soundMs), soundRange(step.data));
  const video = clamp(Math.round(videoFrame), videoRange(step.data));
  return {
    ...step,
    soundMs: sound,
    videoFrame: video,
    save:
      step.save.status === "saved" &&
      clapStepMicOffsetMs(sound, video) === step.save.micOffsetMs
        ? step.save
        : { status: "idle" },
  };
};

/** Play keeps looping while the sliders move. */
export const clapStepReducer = (
  step: Ready,
  action: clapStepReducer.Action
): Ready => {
  switch (action.type) {
    case "sound-handle-dragged":
      return move(step, action.ms, step.videoFrame);
    case "sound-arrow-clicked":
      return move(step, step.soundMs + action.direction, step.videoFrame);
    case "video-handle-dragged":
      return move(step, step.soundMs, action.frame);
    case "video-arrow-clicked":
      return move(step, step.soundMs, step.videoFrame + action.direction);
    case "play-clicked":
      return { ...step, playing: true };
    case "stop-clicked":
      return { ...step, playing: false };
  }
};
