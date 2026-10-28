import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { toast } from "@/components/ui/toast";
import {
  collectDocumentToolCallIds,
  getStreamingDocument,
  unprocessedDocumentToolCalls,
} from "./document-tool-calls";
import {
  createInitialDocumentFlowState,
  displayedDocument,
  documentFlowReducer,
} from "./document-flow-reducer";
import type { DocumentAgentMessage, Mode } from "./types";

const noopExec = Object.assign(() => {}, {
  stop: () => {},
  replace: () => {},
}) as unknown as Parameters<typeof documentFlowReducer>[2];

/**
 * Manages the working document for the article-mode document flow: executes
 * `writeDocument`/`editDocument` tool calls client-side, streams the
 * document in live while the model writes it, and holds the user's edits
 * made meanwhile until the turn ends. Every decision is in
 * `document-flow-reducer.ts`; this hook reports the chat's progress to it.
 *
 * The document is deliberately **not** persisted. Its single source of truth is
 * `initialDocument`, supplied by the route loader (i.e. the database), and it
 * lives in memory for the life of the writer. Chat messages *are* persisted to
 * localStorage by the caller — which is why a restored conversation's tool
 * calls are marked processed on mount: replaying them would otherwise overwrite
 * the loader's value with output from a previous session.
 */
export function useDocumentFlow(opts: {
  /** The persisted value from the route loader — the source of truth. */
  initialDocument?: string;
  mode: Mode;
  isDocumentMode: boolean;
  messages: DocumentAgentMessage[];
  status: "streaming" | "submitted" | "ready" | "error";
  addToolOutput: (args: {
    tool: "writeDocument" | "editDocument";
    toolCallId: string;
    output: string;
  }) => void | PromiseLike<void>;
  /** Notified on every document change, including AI-driven ones. */
  onDocumentChange?: (document: string) => void;
}) {
  const {
    initialDocument,
    mode,
    isDocumentMode,
    messages,
    status,
    addToolOutput,
    onDocumentChange,
  } = opts;

  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;
  const addToolOutputRef = useRef(addToolOutput);
  addToolOutputRef.current = addToolOutput;

  const [state, dispatchToReducer] = useEffectReducer(
    documentFlowReducer,
    () => createInitialDocumentFlowState(initialDocument),
    {
      "notify-document-changed": (_state, effect) => {
        onDocumentChangeRef.current?.(effect.document);
      },
      "report-tool-outputs": (_state, effect) => {
        for (const output of effect.outputs) {
          void addToolOutputRef.current(output);
        }
      },
      "show-warning": (_state, effect) => {
        toast.warning(effect.message);
      },
    }
  );

  const document = useMemo(() => displayedDocument(state), [state]);

  // The document as shown, for async callbacks and for a send in the same
  // tick as an edit (a lint fix). A dispatch only lands on the next render,
  // so `dispatch` moves the ref on at once, by running the (pure) reducer
  // ahead of React; the render then sets both refs to the same value.
  const stateRef = useRef(state);
  stateRef.current = state;
  const documentRef = useRef(document);
  documentRef.current = document;

  const dispatch = useCallback(
    (action: documentFlowReducer.Action) => {
      stateRef.current = documentFlowReducer(
        stateRef.current,
        action,
        noopExec
      );
      documentRef.current = displayedDocument(stateRef.current);
      dispatchToReducer(action);
    },
    [dispatchToReducer]
  );

  const processedToolCallsRef = useRef<Set<string>>(
    // On mount, treat every tool call in the restored conversation as already
    // executed: the loader owns the document, not the transcript.
    new Set(collectDocumentToolCallIds(messages))
  );

  // Switching mode swaps in that mode's stored conversation, whose tool calls
  // belong to an earlier session — mark them processed for the same reason.
  // The document itself is unaffected: a field has one working document,
  // whichever mode wrote it.
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    processedToolCallsRef.current = new Set(
      collectDocumentToolCallIds(messages)
    );
  }, [mode, messages]);

  // Bridge: what the chat reports, as facts about the document, in order —
  // the turn starting, the write streaming in, tool calls settling, and the
  // turn ending (finished, stopped or failed).
  const runningRef = useRef(false);
  useEffect(() => {
    if (!isDocumentMode) return;
    const running = status === "streaming" || status === "submitted";
    if (running && !runningRef.current) dispatch({ type: "turn-started" });

    const calls = unprocessedDocumentToolCalls(
      messages,
      processedToolCallsRef.current
    );
    for (const call of calls)
      processedToolCallsRef.current.add(call.toolCallId);
    if (calls.length > 0) {
      dispatch({ type: "document-tool-calls-settled", calls });
    }

    if (running) {
      const streaming = getStreamingDocument(messages);
      if (streaming !== undefined) {
        dispatch({ type: "document-streamed", ...streaming });
      }
    }

    if (!running && runningRef.current) dispatch({ type: "turn-ended" });
    runningRef.current = running;
  }, [messages, isDocumentMode, status, dispatch]);

  /** The user's edit to the document as shown. */
  const updateDocument = useCallback(
    (content: string | undefined) => {
      if (content === undefined) return;
      dispatch({
        type: "document-edited",
        before: documentRef.current,
        after: content,
      });
    },
    [dispatch]
  );

  /** Drop the session's work and return to the loader's value. */
  const resetDocument = useCallback(() => {
    dispatch({ type: "chat-cleared", savedDocument: initialDocument });
    processedToolCallsRef.current.clear();
  }, [initialDocument, dispatch]);

  return { document, documentRef, resetDocument, updateDocument };
}
