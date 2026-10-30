import type { EffectReducer, EffectEntity } from "use-effect-reducer";

/**
 * A Recording Session panel's header: how long the session has been
 * recording, and which focus indicator it shows while it records.
 *
 * Everything here comes in as a fact. The clock is a `clock-ticked` event
 * carrying `at` (the runner's `Date.now()`), declared once a second by the
 * `tick-every-second` effect while the session records, so the reducer never
 * reads the clock. Whether a Diagram is open comes in on the same tick, and
 * the two focus trackers report through bridges (`lib/focus-tracker.ts`).
 */
export namespace sessionPanelReducer {
  export type State = {
    /** The session is recording (the panel's `isRecording`). */
    recording: boolean;
    /** When the session started, in ms since the epoch. */
    startedAt: number;
    /** The clock as of the last tick, in ms since the epoch. */
    now: number;
    /** A Diagram playground is open, as of the last tick. */
    activeDiagramOpen: boolean;
    diagramFocused: boolean;
    browserFocused: boolean;
    /** The once-a-second clock, while the session records. */
    clock: EffectEntity<State, Action> | null;
  };

  export type Action =
    /** What the panel's session says now: on mount, and when it changes. */
    | {
        type: "session-heard";
        recording: boolean;
        startedAt: number;
        at: number;
        activeDiagramOpen: boolean;
      }
    | { type: "clock-ticked"; at: number; activeDiagramOpen: boolean }
    | { type: "diagram-focus-changed"; focused: boolean }
    | { type: "browser-focus-changed"; focused: boolean };

  export type Effect = { type: "tick-every-second" };

  export type FocusIndicator =
    "diagram-focused" | "url-focused" | "diagram-not-focused";
}

type State = sessionPanelReducer.State;
type Action = sessionPanelReducer.Action;
type Effect = sessionPanelReducer.Effect;

/** The panel as it mounts; a recording session starts its clock at once. */
export const createInitialSessionPanelState = (
  init: {
    recording: boolean;
    startedAt: number;
    at: number;
    activeDiagramOpen: boolean;
    diagramFocused: boolean;
    browserFocused: boolean;
  },
  exec: (effect: Effect) => EffectEntity<State, Action>
): State => ({
  recording: init.recording,
  startedAt: init.startedAt,
  now: init.at,
  activeDiagramOpen: init.activeDiagramOpen,
  diagramFocused: init.diagramFocused,
  browserFocused: init.browserFocused,
  clock: init.recording ? exec({ type: "tick-every-second" }) : null,
});

/** Whole seconds since the session started, as of the last tick. */
export const selectElapsedSeconds = (state: State) =>
  Math.floor((state.now - state.startedAt) / 1000);

/**
 * What the header says about focus while recording: a focused Diagram (a
 * snapshot will be pinned) beats a focused browser URL (links will be
 * captured), which beats an open but unfocused Diagram. `null` when not
 * recording, or when none of those hold.
 */
export const selectFocusIndicator = (
  state: State
): sessionPanelReducer.FocusIndicator | null => {
  if (!state.recording) return null;
  if (state.diagramFocused) return "diagram-focused";
  if (state.browserFocused) return "url-focused";
  if (state.activeDiagramOpen) return "diagram-not-focused";
  return null;
};

export const sessionPanelReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "session-heard": {
      if (!action.recording) {
        if (state.clock) exec.stop(state.clock);
        return {
          ...state,
          recording: false,
          startedAt: action.startedAt,
          clock: null,
        };
      }
      const next = {
        ...state,
        recording: true,
        startedAt: action.startedAt,
        now: action.at,
        activeDiagramOpen: action.activeDiagramOpen,
      };
      if (state.recording && state.startedAt === action.startedAt) {
        return next;
      }
      // A new session (or a restarted one) counts from its own start.
      if (state.clock) exec.stop(state.clock);
      return { ...next, clock: exec({ type: "tick-every-second" }) };
    }
    case "clock-ticked":
      if (!state.recording) return state;
      return {
        ...state,
        now: action.at,
        activeDiagramOpen: action.activeDiagramOpen,
      };
    case "diagram-focus-changed":
      if (state.diagramFocused === action.focused) return state;
      return { ...state, diagramFocused: action.focused };
    case "browser-focus-changed":
      if (state.browserFocused === action.focused) return state;
      return { ...state, browserFocused: action.focused };
  }
};
