import type { EffectReducer } from "use-effect-reducer";
import { sceneAt } from "@/packages/clip-source";
import type { Scene, SceneSegment } from "@/packages/scene-layout";

/**
 * Editor playback of a CVM-recorder Clip: its mic plays as the clock (the
 * `<video>` every Clip already has), and its camera and screen files play
 * along, muted, in the picture's clock — the mic offset after the mic — to be
 * drawn on a canvas in the scene of the moment.
 *
 * Events are what the clock and the picture `<video>`s report; effects are
 * what the runner does to the picture `<video>`s. Only the sources the
 * picture opens are mounted (a Short's Camera-only picture has no screen
 * `<video>`), so only those are ever sent anywhere or waited on.
 */
export type PictureSource = "camera" | "screen";

/** How far a picture `<video>` may wander from the mic before it is reseeked. */
export const MAX_PICTURE_DRIFT_SECONDS = 0.1;

export namespace compositePlaybackReducer {
  export interface State {
    readonly segments: readonly SceneSegment[];
    /** Picture time = clock time + this (the Recording Session's mic offset). */
    readonly offsetSeconds: number;
    /** Where the clock says the picture is, in the picture's clock. */
    readonly pictureTime: number;
    readonly playing: boolean;
    /** The clock's playback rate, for a source mounted mid-play. */
    readonly rate: number;
    /** The picture `<video>`s mounted: the sources the picture opens. */
    readonly sources: readonly PictureSource[];
    /** Picture `<video>`s told to seek that have not reported `seeked` yet. */
    readonly seeking: readonly PictureSource[];
  }

  export type Action =
    | { type: "clock-played"; clockTime: number; rate: number }
    | { type: "clock-paused"; clockTime: number }
    | { type: "clock-seeked"; clockTime: number }
    | {
        type: "clock-ticked";
        clockTime: number;
        sourceTimes: Readonly<Record<PictureSource, number>>;
      }
    | { type: "clock-rate-changed"; rate: number }
    | { type: "source-seeked"; source: PictureSource }
    /**
     * The Clip's picture was redrawn (a Scene Override, a new mic offset):
     * a Short's override may also mount or unmount its screen `<video>`.
     */
    | {
        type: "clip-source-changed";
        segments: readonly SceneSegment[];
        offsetSeconds: number;
        sources: readonly PictureSource[];
      };

  export type Effect =
    | {
        type: "play-sources";
        at: number;
        rate: number;
        sources: PictureSource[];
      }
    | { type: "pause-sources"; at: number; sources: PictureSource[] }
    | { type: "seek-sources"; at: number; sources: PictureSource[] }
    | { type: "set-sources-rate"; rate: number; sources: PictureSource[] };
}

export const createInitialCompositePlaybackState = (o: {
  segments: readonly SceneSegment[];
  offsetSeconds: number;
  sources: readonly PictureSource[];
}): compositePlaybackReducer.State => ({
  segments: o.segments,
  offsetSeconds: o.offsetSeconds,
  pictureTime: o.segments[0]?.startSeconds ?? 0,
  playing: false,
  rate: 1,
  sources: o.sources,
  seeking: [],
});

/** Rounds away float noise from adding the offset (10.149999). */
const tidy = (seconds: number) => Math.round(seconds * 1e6) / 1e6;

/** The scene the canvas draws now. */
export const compositeScene = (state: compositePlaybackReducer.State): Scene =>
  sceneAt(state.segments, state.pictureTime);

export const compositePlaybackReducer: EffectReducer<
  compositePlaybackReducer.State,
  compositePlaybackReducer.Action,
  compositePlaybackReducer.Effect
> = (state, action, exec) => {
  const picture = (clockTime: number) => tidy(clockTime + state.offsetSeconds);
  const sources = [...state.sources];
  switch (action.type) {
    case "clock-played": {
      const at = picture(action.clockTime);
      exec({ type: "play-sources", at, rate: action.rate, sources });
      return { ...state, pictureTime: at, playing: true, rate: action.rate };
    }
    case "clock-paused": {
      const at = picture(action.clockTime);
      exec({ type: "pause-sources", at, sources });
      return { ...state, pictureTime: at, playing: false };
    }
    case "clock-seeked": {
      const at = picture(action.clockTime);
      exec({ type: "seek-sources", at, sources });
      return { ...state, pictureTime: at, seeking: sources };
    }
    case "clock-ticked": {
      const at = picture(action.clockTime);
      if (!state.playing) return { ...state, pictureTime: at };
      const drifted = sources.filter(
        (s) =>
          !state.seeking.includes(s) &&
          Math.abs(action.sourceTimes[s] - at) > MAX_PICTURE_DRIFT_SECONDS
      );
      if (drifted.length > 0) {
        exec({ type: "seek-sources", at, sources: drifted });
      }
      return {
        ...state,
        pictureTime: at,
        seeking: [...state.seeking, ...drifted],
      };
    }
    case "clock-rate-changed":
      exec({ type: "set-sources-rate", rate: action.rate, sources });
      return { ...state, rate: action.rate };
    case "clip-source-changed": {
      const at = state.pictureTime;
      const mounted = action.sources.filter((s) => !sources.includes(s));
      if (mounted.length > 0) {
        exec(
          state.playing
            ? { type: "play-sources", at, rate: state.rate, sources: mounted }
            : { type: "seek-sources", at, sources: mounted }
        );
      }
      return {
        ...state,
        segments: action.segments,
        offsetSeconds: action.offsetSeconds,
        sources: action.sources,
        seeking: [
          ...state.seeking.filter((s) => action.sources.includes(s)),
          ...(state.playing ? [] : mounted),
        ],
      };
    }
    case "source-seeked":
      return {
        ...state,
        seeking: state.seeking.filter((s) => s !== action.source),
      };
  }
};
