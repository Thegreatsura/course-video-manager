import type { EffectReducer, EffectEntity } from "use-effect-reducer";

/**
 * WHETHER AN EDITOR STILL NEEDS THE RECORDER (#2383). Hearing a Video's
 * recorder events is what keeps the recorder open for it and the recorder
 * service running (ADR 0053), so an editor left in a window Matt has not
 * focused for `RECORDER_AWAY_MS` stops hearing them: it lets the recorder go.
 * The app server then closes the recorder (the Cam Link goes) and, once
 * nothing else needs it for its idle time, stops the recorder service.
 * Focus coming back hears them again, which starts it all again as opening
 * the editor does.
 *
 * Never while a Recording Session is recording, stopping, or placing its
 * last Take (`recording-heard`): Matt films with another window focused,
 * and the editor must hear every Take. The away count starts afresh once
 * the Recording Session is over.
 *
 * The count is an effect (`wait-while-away`), so tests run its time as
 * events and never wait on a clock.
 */

/** How long the window goes unfocused before the editor lets the recorder go. */
export const RECORDER_AWAY_MS = 2 * 60_000;

export namespace recorderAttentionReducer {
  export type State = {
    /** The window has focus (and so is visible). */
    focused: boolean;
    /** A Recording Session is recording, stopping or placing its last Take. */
    recording: boolean;
    /** The editor let the recorder go, until the window is focused again. */
    away: boolean;
    /** The away count, while it runs. */
    count: EffectEntity<State, Action> | null;
  };

  export type Action =
    /** `blur`, a hidden tab, or a page that loaded without focus. */
    | { type: "window-left" }
    /** `focus`, or the tab shown again with focus. */
    | { type: "window-focused" }
    /** What the editor's recorder state says now. */
    | { type: "recording-heard"; recording: boolean }
    | { type: "away-time-elapsed" };

  export type Effect = { type: "wait-while-away"; ms: number };
}

type State = recorderAttentionReducer.State;
type Action = recorderAttentionReducer.Action;
type Effect = recorderAttentionReducer.Effect;
type Exec = Parameters<EffectReducer<State, Action, Effect>>[2];

export const createInitialRecorderAttentionState = (): State => ({
  focused: true,
  recording: false,
  away: false,
  count: null,
});

/** Whether the editor hears its Video's recorder events (and so holds it). */
export const holdsRecorder = (state: State) => !state.away;

const stopCount = (state: State, exec: Exec): State => {
  if (state.count) exec.stop(state.count);
  return { ...state, count: null };
};

/** Starts the away count afresh, if the window is away and nothing records. */
const recount = (state: State, exec: Exec): State => {
  const stopped = stopCount(state, exec);
  if (stopped.focused || stopped.recording || stopped.away) return stopped;
  return {
    ...stopped,
    count: exec({ type: "wait-while-away", ms: RECORDER_AWAY_MS }),
  };
};

export const recorderAttentionReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "window-left":
      if (!state.focused) return state;
      return recount({ ...state, focused: false }, exec);
    case "window-focused":
      if (state.focused) return state;
      return stopCount({ ...state, focused: true, away: false }, exec);
    case "recording-heard":
      if (state.recording === action.recording) return state;
      // A recording holds the recorder, away or not.
      return recount(
        {
          ...state,
          recording: action.recording,
          away: state.away && !action.recording,
        },
        exec
      );
    case "away-time-elapsed":
      if (state.focused || state.recording || !state.count) return state;
      return { ...state, count: null, away: true };
  }
};
