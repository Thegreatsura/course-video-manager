import type { EffectReducer, EffectReducerExec } from "use-effect-reducer";
import {
  foldDocumentToolCall,
  type DocumentToolOutput,
  type SettledDocumentToolPart,
} from "./document-tool-calls";
import {
  applyPendingEdits,
  partitionAnchored,
  queuePendingEdit,
  type PendingEdit,
} from "./pending-edits";

/**
 * The Article Writer's working document, while the model writes it and while
 * the user edits it.
 *
 * `text` is the real text: what the model's `writeDocument` streamed in and
 * its tool calls left, or (between turns) what the user made it. While a turn
 * runs, the user's edits do not touch it. They wait in `pendingEdits`, and the
 * document on screen is `text` with them applied ({@link displayedDocument}).
 * Each new chunk of the stream replaces `text`, and the edits stay where they
 * were, because each is anchored to text that had already arrived. When the
 * turn ends (finished, stopped or failed), the edits are folded into `text`
 * in one step.
 *
 * The working document is never persisted here: the host is told of each
 * change (`notify-document-changed`) and saves on Apply.
 */
export namespace documentFlowReducer {
  export interface State {
    text: string | undefined;
    /** A turn is running: the user's edits wait in `pendingEdits`. */
    turnRunning: boolean;
    /** The `writeDocument` whose content is still streaming in, if any. */
    writing: string | null;
    pendingEdits: PendingEdit[];
  }

  export type Action =
    // Reported by the chat transport
    | { type: "turn-started" }
    /** The turn finished, was stopped, or failed. */
    | { type: "turn-ended" }
    | { type: "document-streamed"; toolCallId: string; content: string }
    | { type: "document-tool-calls-settled"; calls: SettledDocumentToolPart[] }
    // Gestures
    /** The user changed the shown document from `before` to `after`. */
    | { type: "document-edited"; before: string | undefined; after: string }
    /** The chat was cleared: the document goes back to the saved value. */
    | { type: "chat-cleared"; savedDocument: string | undefined };

  export type Effect =
    | { type: "notify-document-changed"; document: string }
    | { type: "report-tool-outputs"; outputs: DocumentToolOutput[] }
    | { type: "show-warning"; message: string };
}

type State = documentFlowReducer.State;
type Exec = EffectReducerExec<
  State,
  documentFlowReducer.Action,
  documentFlowReducer.Effect
>;

export const createInitialDocumentFlowState = (
  document: string | undefined
): State => ({
  text: document,
  turnRunning: false,
  writing: null,
  pendingEdits: [],
});

/** The document as the user sees it: the real text with the pending edits. */
export function displayedDocument(state: State): string | undefined {
  if (state.text === undefined) return undefined;
  return applyPendingEdits(state.text, state.pendingEdits).document;
}

const edits = (n: number) => (n === 1 ? "1 edit" : `${n} edits`);

/** Declare the change, if the shown document changed. */
function changed(prev: State, next: State, exec: Exec): State {
  const before = displayedDocument(prev);
  const after = displayedDocument(next);
  if (after !== before) {
    exec({ type: "notify-document-changed", document: after ?? "" });
  }
  return next;
}

/**
 * New real text. Any pending edit whose anchor it no longer holds (the model
 * rewrote that text) is dropped, never moved somewhere else.
 */
function withText(state: State, text: string | undefined, exec: Exec): State {
  if (text === undefined || state.pendingEdits.length === 0) {
    return { ...state, text };
  }
  const { kept, dropped } = partitionAnchored(text, state.pendingEdits);
  if (dropped.length > 0) {
    exec({
      type: "show-warning",
      message: `Dropped ${edits(dropped.length)} you made while the model wrote: it rewrote that text.`,
    });
  }
  return { ...state, text, pendingEdits: kept };
}

/** A new write replaces the document from scratch: no anchor survives it. */
function discardPendingEdits(state: State, exec: Exec): State {
  if (state.pendingEdits.length === 0) return state;
  exec({
    type: "show-warning",
    message: `Dropped ${edits(state.pendingEdits.length)} you made while the model wrote: it started the document again.`,
  });
  return { ...state, pendingEdits: [] };
}

/** Where the arrived text ends: a line still streaming in is not editable. */
function editableEnd(state: State): number {
  const text = state.text ?? "";
  return state.writing === null ? text.length : text.lastIndexOf("\n") + 1;
}

export const documentFlowReducer: EffectReducer<
  State,
  documentFlowReducer.Action,
  documentFlowReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "turn-started":
      return { ...state, turnRunning: true };

    case "turn-ended": {
      const ended = { ...state, turnRunning: false, writing: null };
      if (state.text === undefined || state.pendingEdits.length === 0) {
        return ended;
      }
      const { document, dropped } = applyPendingEdits(
        state.text,
        state.pendingEdits
      );
      if (dropped.length > 0) {
        exec({
          type: "show-warning",
          message: `Dropped ${edits(dropped.length)} you made while the model wrote: the text under them changed.`,
        });
      }
      exec({ type: "notify-document-changed", document });
      return { ...ended, text: document, pendingEdits: [] };
    }

    case "document-streamed": {
      const restarted =
        action.toolCallId !== state.writing
          ? discardPendingEdits(state, exec)
          : state;
      return changed(
        state,
        withText(
          { ...restarted, writing: action.toolCallId },
          action.content,
          exec
        ),
        exec
      );
    }

    case "document-tool-calls-settled": {
      let next = state;
      const outputs: DocumentToolOutput[] = [];
      for (const call of action.calls) {
        const folded = foldDocumentToolCall(next.text, call);
        outputs.push(folded.output);
        if (call.type === "tool-writeDocument") {
          // The streamed write's last chunk keeps the anchors; any other
          // write replaces the document from scratch.
          if (call.toolCallId !== next.writing) {
            next = discardPendingEdits(next, exec);
          }
          next = { ...next, writing: null };
        }
        next = withText(next, folded.document, exec);
      }
      if (outputs.length > 0) exec({ type: "report-tool-outputs", outputs });
      return changed(state, next, exec);
    }

    case "document-edited": {
      if (!state.turnRunning || state.text === undefined) {
        return changed(state, { ...state, text: action.after }, exec);
      }
      const result = queuePendingEdit({
        text: state.text,
        edits: state.pendingEdits,
        before: action.before ?? "",
        after: action.after,
        editableEnd: editableEnd(state),
      });
      if (result.kind === "still-arriving") {
        exec({
          type: "show-warning",
          message:
            "That line is still being written. Try again once it has arrived.",
        });
        return state;
      }
      if (result.kind === "stale") {
        exec({
          type: "show-warning",
          message: "The document changed under that edit. Try it again.",
        });
        return state;
      }
      return changed(state, { ...state, pendingEdits: result.edits }, exec);
    }

    case "chat-cleared": {
      const cleared = discardPendingEdits(state, exec);
      return changed(
        state,
        { ...cleared, text: action.savedDocument, writing: null },
        exec
      );
    }
  }
};
