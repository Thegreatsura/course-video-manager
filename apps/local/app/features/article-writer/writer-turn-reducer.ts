import type { EffectReducer, EffectReducerExec } from "use-effect-reducer";
import { classifyChatError, type WriterFailure } from "./writer-errors";

/**
 * One writer turn: a user message going out and the model's reply coming
 * back. The chat transport (`useChat`) owns the messages; this reducer owns
 * what the user is told about the turn and what Retry and Regenerate do.
 *
 * The turn's failure is shown inline, after the last message — the failed
 * turn is always the last one, because a new send replaces it.
 */
export namespace writerTurnReducer {
  export interface State {
    phase: "idle" | "running" | "failed";
    failure: WriterFailure | null;
    /** The user pressed Stop; the turn ending now is not a failure. */
    stopping: boolean;
  }

  export type Action =
    // Reported by the chat transport
    | { type: "turn-started" }
    | { type: "turn-finished"; unrecoveredToolError: string | null }
    | { type: "turn-failed"; error: string }
    // Gestures
    | { type: "stop-requested" }
    | { type: "retry-requested" }
    | { type: "regenerate-requested" }
    | { type: "chat-cleared" };

  export type Effect =
    /** Drop the last assistant reply, if any, and re-run the last user message. */
    { type: "regenerate-last-turn" } | { type: "stop-stream" };
}

export const createInitialWriterTurnState = (): writerTurnReducer.State => ({
  phase: "idle",
  failure: null,
  stopping: false,
});

const rerun = (
  exec: EffectReducerExec<
    writerTurnReducer.State,
    writerTurnReducer.Action,
    writerTurnReducer.Effect
  >
): writerTurnReducer.State => {
  exec({ type: "regenerate-last-turn" });
  return { phase: "running", failure: null, stopping: false };
};

export const writerTurnReducer: EffectReducer<
  writerTurnReducer.State,
  writerTurnReducer.Action,
  writerTurnReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "turn-started":
      return { phase: "running", failure: null, stopping: false };

    case "turn-finished":
      if (!state.stopping && action.unrecoveredToolError !== null) {
        return {
          phase: "failed",
          failure: {
            kind: "invalid-tool-input",
            message: action.unrecoveredToolError,
          },
          stopping: false,
        };
      }
      return createInitialWriterTurnState();

    case "turn-failed":
      if (state.stopping) return createInitialWriterTurnState();
      return {
        phase: "failed",
        failure: classifyChatError(action.error),
        stopping: false,
      };

    case "stop-requested":
      if (state.phase !== "running") return state;
      exec({ type: "stop-stream" });
      return { ...state, stopping: true };

    case "retry-requested":
      if (state.phase !== "failed") return state;
      return rerun(exec);

    case "regenerate-requested":
      if (state.phase === "running") return state;
      return rerun(exec);

    case "chat-cleared":
      return createInitialWriterTurnState();
  }
};
