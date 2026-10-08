import { useEffect, useRef } from "react";
import { useEffectReducer } from "use-effect-reducer";
import {
  createInitialWriterTurnState,
  writerTurnReducer,
} from "./writer-turn-reducer";
import { findUnrecoveredToolError } from "./writer-errors";
import type { DocumentAgentMessage } from "./types";
import type { ChatStatus } from "./use-message-queue";

/**
 * The writer turn's reducer, wired to `useChat`. The effect runner calls the
 * transport; the bridge below reports the transport's status changes back as
 * turn events. Every decision is in `writer-turn-reducer.ts`.
 */
export function useWriterTurn(opts: {
  messages: DocumentAgentMessage[];
  status: ChatStatus;
  error: Error | undefined;
  /** Re-run the last user message, dropping the last assistant reply. */
  regenerate: () => void;
  stop: () => void;
}) {
  const { messages, status, error } = opts;
  const regenerateRef = useRef(opts.regenerate);
  regenerateRef.current = opts.regenerate;
  const stopRef = useRef(opts.stop);
  stopRef.current = opts.stop;

  const [state, dispatch] = useEffectReducer(
    writerTurnReducer,
    createInitialWriterTurnState(),
    {
      "regenerate-last-turn": () => {
        regenerateRef.current();
      },
      "stop-stream": () => {
        stopRef.current();
      },
    }
  );

  // Bridge: a change of the transport's status is a fact about the turn.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const before = prevStatusRef.current;
    prevStatusRef.current = status;
    if (before === status) return;
    if (status === "submitted") {
      dispatch({ type: "turn-started" });
    } else if (status === "error") {
      dispatch({ type: "turn-failed", error: error?.message ?? "" });
    } else if (status === "ready") {
      dispatch({
        type: "turn-finished",
        unrecoveredToolError: findUnrecoveredToolError(messages),
      });
    }
  }, [status, error, messages, dispatch]);

  return { failure: state.failure, dispatch };
}
