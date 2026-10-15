import type { EffectReducer } from "use-effect-reducer";
import { sceneAt } from "@/packages/clip-source";
import type { Scene, SceneSegment } from "@/packages/scene-layout";

/**
 * Editor playback of a CVM-recorder Clip: its mic plays as the clock (the
 * `<video>` every Clip already has), and its camera and screen files play
 * along, muted, in the picture's clock — the mic offset after the mic — to be
 * drawn on a canvas in the scene of the moment.
 *
 * Events are what the clock, the picture `<video>`s and the editor report;
 * effects are what the runner does to the clock and the picture `<video>`s.
 * Only the sources the picture opens are mounted (a Short's Camera-only
 * picture has no screen `<video>`), so only those are ever sent anywhere or
 * waited on.
 *
 * A seek on the camera (1440p, 2 s GOP, B-frames) decodes up to two seconds of
 * frames, so the reducer seeks as little as it can:
 *
 * - a source already within `SEEK_TOLERANCE_SECONDS` of where it is sent is
 *   left where it is (playing in place seeks nothing), and a pause never
 *   seeks;
 * - a source has at most one seek in flight: it is never re-sent while
 *   seeking, and is re-sent once it lands if the target moved meanwhile
 *   (a scrub's seeks coalesce);
 * - drift while playing is pulled back by nudging the source's playback rate,
 *   and reseeked only past `RESEEK_DRIFT_SECONDS`;
 * - when the editor plays and a source must seek first, the clock is held
 *   (paused) until every source has landed, and then all start together —
 *   or after `MAX_HOLD_MS`, should a seek never land.
 */
export type PictureSource = "camera" | "screen";

/**
 * Close enough not to seek: a picture `<video>` this near its target is left
 * where it is. About a frame and a half at 30 fps, and well under what lip
 * sync can show.
 */
export const SEEK_TOLERANCE_SECONDS = 0.05;

/**
 * Drift past which a playing source is reseeked rather than nudged. A seek
 * costs a GOP decode and freezes the picture; a nudge at
 * `DRIFT_NUDGE_FACTOR` closes this much drift in five seconds, invisibly.
 */
export const RESEEK_DRIFT_SECONDS = 0.5;

/** A drifting source starts being nudged past this… */
export const NUDGE_START_SECONDS = SEEK_TOLERANCE_SECONDS;
/** …and stops once it is back within this of the clock (or crosses it). */
export const NUDGE_STOP_SECONDS = 0.01;

/** A nudged source plays this much faster or slower than the clock. */
export const DRIFT_NUDGE_FACTOR = 0.1;

/** The longest the clock is held for a seek that never lands. */
export const MAX_HOLD_MS = 1500;

export namespace compositePlaybackReducer {
  export type SourceTimes = Readonly<Record<PictureSource, number>>;

  export interface State {
    readonly segments: readonly SceneSegment[];
    /** Picture time = clock time + this (the Recording Session's mic offset). */
    readonly offsetSeconds: number;
    /** Where the clock says the picture is, in the picture's clock. */
    readonly pictureTime: number;
    /** The clock and the sources are playing (not held). */
    readonly playing: boolean;
    /** The clock's playback rate. */
    readonly rate: number;
    /** The picture `<video>`s mounted: the sources the picture opens. */
    readonly sources: readonly PictureSource[];
    /** Picture `<video>`s told to seek that have not reported `seeked` yet. */
    readonly seeking: readonly PictureSource[];
    /** Where each source was last sent, to re-aim one the playhead left. */
    readonly seekTargets: Readonly<Partial<Record<PictureSource, number>>>;
    /** Sources playing faster (1) or slower (-1) than the clock to close drift. */
    readonly nudged: Readonly<Partial<Record<PictureSource, 1 | -1>>>;
    /** The editor wants this Clip playing (it is on screen and running). */
    readonly editorPlaying: boolean;
    /** The clock is held until the sources land; the id names this hold. */
    readonly hold: { readonly id: number } | null;
    readonly holdsStarted: number;
  }

  export type Action =
    | {
        type: "clock-played";
        clockTime: number;
        rate: number;
        sourceTimes: SourceTimes;
      }
    | { type: "clock-paused"; clockTime: number; sourceTimes: SourceTimes }
    | { type: "clock-seeked"; clockTime: number; sourceTimes: SourceTimes }
    | { type: "clock-ticked"; clockTime: number; sourceTimes: SourceTimes }
    | { type: "clock-rate-changed"; rate: number }
    /** A picture `<video>` finished a seek. */
    | { type: "source-seeked"; source: PictureSource }
    | { type: "editor-played" }
    | { type: "editor-paused" }
    | { type: "hold-expired"; holdId: number }
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
    | { type: "seek-sources"; at: number; sources: PictureSource[] }
    /** Set the rate and play. Never seeks. */
    | { type: "play-sources"; rate: number; sources: PictureSource[] }
    /** Pause. Never seeks. */
    | { type: "pause-sources"; sources: PictureSource[] }
    | { type: "set-sources-rate"; rate: number; sources: PictureSource[] }
    /** Pause the clock until the sources land; expire after `expiresAfterMs`. */
    | { type: "hold-clock"; holdId: number; expiresAfterMs: number }
    | { type: "play-clock" };
}

type State = compositePlaybackReducer.State;
type Exec = Parameters<
  EffectReducer<
    State,
    compositePlaybackReducer.Action,
    compositePlaybackReducer.Effect
  >
>[2];

export const createInitialCompositePlaybackState = (o: {
  segments: readonly SceneSegment[];
  offsetSeconds: number;
  sources: readonly PictureSource[];
}): State => ({
  segments: o.segments,
  offsetSeconds: o.offsetSeconds,
  pictureTime: o.segments[0]?.startSeconds ?? 0,
  playing: false,
  rate: 1,
  sources: o.sources,
  seeking: [],
  seekTargets: {},
  nudged: {},
  editorPlaying: false,
  hold: null,
  holdsStarted: 0,
});

/** Rounds away float noise from adding the offset (10.149999). */
const tidy = (seconds: number) => Math.round(seconds * 1e6) / 1e6;

const near = (a: number, b: number) =>
  Math.abs(a - b) <= SEEK_TOLERANCE_SECONDS;

/** The scene the canvas draws now. */
export const compositeScene = (state: State): Scene =>
  sceneAt(state.segments, state.pictureTime);

/** Sends `sources` to `at`, recording them as seeking there. */
const seek = (
  state: State,
  at: number,
  sources: PictureSource[],
  exec: Exec
): State => {
  if (sources.length === 0) return state;
  exec({ type: "seek-sources", at, sources });
  const seekTargets = { ...state.seekTargets };
  for (const s of sources) seekTargets[s] = at;
  return {
    ...state,
    seeking: [...state.seeking.filter((s) => !sources.includes(s)), ...sources],
    seekTargets,
  };
};

/**
 * Sends to `at` every source not already there and not already seeking (an
 * in-flight seek is re-aimed when it lands), and records them as seeking.
 */
const seekAway = (
  state: State,
  at: number,
  sourceTimes: compositePlaybackReducer.SourceTimes,
  exec: Exec
): State => {
  const away = state.sources.filter(
    (s) => !state.seeking.includes(s) && !near(sourceTimes[s], at)
  );
  return seek(state, at, away, exec);
};

/** Starts the sources and the clock together, ending any hold. */
const start = (state: State, exec: Exec): State => {
  exec({ type: "play-sources", rate: state.rate, sources: [...state.sources] });
  if (state.hold) exec({ type: "play-clock" });
  return { ...state, playing: true, hold: null, nudged: {} };
};

/** Ends a hold once nothing is left seeking. */
const startIfLanded = (state: State, exec: Exec): State =>
  state.hold && state.seeking.length === 0 ? start(state, exec) : state;

/** Picks up, keeps or drops a rate nudge on one playing source. */
const nudgeFor = (drift: number, current: 1 | -1 | undefined) => {
  if (Math.abs(drift) > NUDGE_START_SECONDS) return drift > 0 ? -1 : 1;
  if (current === -1 && drift < NUDGE_STOP_SECONDS) return undefined;
  if (current === 1 && drift > -NUDGE_STOP_SECONDS) return undefined;
  return current;
};

export const compositePlaybackReducer: EffectReducer<
  compositePlaybackReducer.State,
  compositePlaybackReducer.Action,
  compositePlaybackReducer.Effect
> = (state, action, exec) => {
  const picture = (clockTime: number) => tidy(clockTime + state.offsetSeconds);
  switch (action.type) {
    case "clock-played": {
      const at = picture(action.clockTime);
      const next = seekAway(
        { ...state, pictureTime: at, rate: action.rate, hold: null },
        at,
        action.sourceTimes,
        exec
      );
      if (state.editorPlaying && next.seeking.length > 0) {
        const id = state.holdsStarted + 1;
        exec({ type: "hold-clock", holdId: id, expiresAfterMs: MAX_HOLD_MS });
        return { ...next, playing: false, hold: { id }, holdsStarted: id };
      }
      return start(next, exec);
    }
    case "clock-paused": {
      // The hold's own pause.
      if (state.hold) return state;
      // Paused where they are, never seeked: Chrome's audio clock reports a
      // stale time at its pause and jumps on resume, so a seek here is wasted.
      // The next play lines the picture up with wherever the clock resumes.
      exec({ type: "pause-sources", sources: [...state.sources] });
      return {
        ...state,
        pictureTime: picture(action.clockTime),
        playing: false,
        nudged: {},
      };
    }
    case "clock-seeked": {
      const at = picture(action.clockTime);
      return seekAway(
        { ...state, pictureTime: at },
        at,
        action.sourceTimes,
        exec
      );
    }
    case "clock-ticked": {
      const at = picture(action.clockTime);
      if (!state.playing) return { ...state, pictureTime: at };
      const reseek: PictureSource[] = [];
      const nudged = { ...state.nudged };
      for (const s of state.sources) {
        if (state.seeking.includes(s)) continue;
        const drift = action.sourceTimes[s] - at;
        const was = state.nudged[s];
        const lost = Math.abs(drift) > RESEEK_DRIFT_SECONDS;
        if (lost) reseek.push(s);
        // A reseeked source goes back to the clock's own rate.
        const now = lost ? undefined : nudgeFor(drift, was);
        if (now === was) continue;
        if (now === undefined) delete nudged[s];
        else nudged[s] = now;
        exec({
          type: "set-sources-rate",
          rate: tidy(state.rate * (1 + (now ?? 0) * DRIFT_NUDGE_FACTOR)),
          sources: [s],
        });
      }
      return seek({ ...state, pictureTime: at, nudged }, at, reseek, exec);
    }
    case "clock-rate-changed":
      exec({
        type: "set-sources-rate",
        rate: action.rate,
        sources: [...state.sources],
      });
      return { ...state, rate: action.rate, nudged: {} };
    case "source-seeked": {
      if (!state.seeking.includes(action.source)) return state;
      // The playhead moved on while this seek was in flight (a scrub): send
      // it on once more. A playing source is left to the drift check instead.
      const target = state.seekTargets[action.source] ?? state.pictureTime;
      if (!state.playing && !near(target, state.pictureTime)) {
        return seek(state, state.pictureTime, [action.source], exec);
      }
      return startIfLanded(
        {
          ...state,
          seeking: state.seeking.filter((s) => s !== action.source),
        },
        exec
      );
    }
    case "editor-played":
      return { ...state, editorPlaying: true };
    case "editor-paused":
      // A held clock is already paused; it simply never resumes.
      return { ...state, editorPlaying: false, hold: null };
    case "hold-expired":
      return state.hold?.id === action.holdId ? start(state, exec) : state;
    case "clip-source-changed": {
      const at = state.pictureTime;
      const mounted = action.sources.filter((s) => !state.sources.includes(s));
      // A new `<video>`'s position is unknown: always seek it.
      const seeked = seek(state, at, mounted, exec);
      if (mounted.length > 0 && state.playing) {
        exec({ type: "play-sources", rate: state.rate, sources: mounted });
      }
      const nudged = { ...state.nudged };
      for (const s of state.sources) {
        if (!action.sources.includes(s)) delete nudged[s];
      }
      return startIfLanded(
        {
          ...seeked,
          segments: action.segments,
          offsetSeconds: action.offsetSeconds,
          sources: action.sources,
          nudged,
          seeking: seeked.seeking.filter((s) => action.sources.includes(s)),
        },
        exec
      );
    }
  }
};
