/**
 * Pure reduction of a chat transcript's document tool calls (`writeDocument`,
 * `editDocument`) into a document string.
 *
 * The writer executes these tools client-side: the model emits a tool call, the
 * UI folds it into the working document and reports an output back to the chat.
 * Keeping the fold pure means the hook that drives it is a single effect over
 * `messages` rather than one effect per tool, and the interesting cases (an edit
 * landing on top of a write, a failed edit, a replayed transcript) are testable
 * without React.
 */

import { applyEdits } from "./document-editing-engine";
import type { DocumentAgentMessage } from "./types";

export type DocumentToolOutput = {
  tool: "writeDocument" | "editDocument";
  toolCallId: string;
  output: string;
};

export type DocumentToolCallOutcome = {
  /** The document after folding in every not-yet-processed tool call. */
  document: string | undefined;
  /** Tool call ids folded in by this pass — none of them were processed before. */
  processedToolCallIds: string[];
  /** Outputs to report back to the chat, in the order they were produced. */
  outputs: DocumentToolOutput[];
};

type DocumentToolPart = Extract<
  DocumentAgentMessage["parts"][number],
  { type: "tool-writeDocument" | "tool-editDocument" }
>;

/**
 * The same union minus its `input-streaming` states (whose input is still a
 * partial object), with `input` known to have arrived — i.e. it passed the
 * tool's input schema.
 */
type Settled<Part> = Part extends { state: "input-streaming" }
  ? never
  : Part extends { input?: unknown }
    ? Part & { input: NonNullable<Part["input"]> }
    : never;
export type SettledDocumentToolPart = Settled<DocumentToolPart>;

/**
 * A tool call whose input has stopped streaming, and so can be executed.
 * `input-streaming` parts are handled by {@link getStreamingDocument} instead.
 */
function isSettledDocumentToolCall(
  part: DocumentAgentMessage["parts"][number]
): part is SettledDocumentToolPart {
  return (
    (part.type === "tool-writeDocument" || part.type === "tool-editDocument") &&
    part.state !== "input-streaming" &&
    Boolean(part.input)
  );
}

function* settledDocumentToolCalls(messages: DocumentAgentMessage[]) {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (isSettledDocumentToolCall(part)) yield part;
    }
  }
}

/**
 * Every settled document tool call in the transcript. Used to mark a restored
 * conversation's tool calls as already-processed, so replaying old messages
 * never overwrites the document the route loader supplied.
 */
export function collectDocumentToolCallIds(
  messages: DocumentAgentMessage[]
): string[] {
  return Array.from(settledDocumentToolCalls(messages), (p) => p.toolCallId);
}

/**
 * The settled document tool calls not in `processedToolCallIds`, in
 * transcript order.
 */
export function unprocessedDocumentToolCalls(
  messages: DocumentAgentMessage[],
  processedToolCallIds: ReadonlySet<string>
): SettledDocumentToolPart[] {
  return Array.from(settledDocumentToolCalls(messages)).filter(
    (part) => !processedToolCallIds.has(part.toolCallId)
  );
}

/**
 * Fold one settled tool call into `document`: a write replaces it, an edit
 * applies to it (or fails, leaving it as it was).
 */
export function foldDocumentToolCall(
  document: string | undefined,
  part: SettledDocumentToolPart
): { document: string | undefined; output: DocumentToolOutput } {
  if (part.type === "tool-writeDocument") {
    return {
      document: part.input.content,
      output: {
        tool: "writeDocument",
        toolCallId: part.toolCallId,
        output: "Document written successfully.",
      },
    };
  }
  const result = applyEdits(document ?? "", part.input.edits);
  if ("error" in result) {
    return {
      document,
      output: {
        tool: "editDocument",
        toolCallId: part.toolCallId,
        output: result.error,
      },
    };
  }
  return {
    document: result.document,
    output: {
      tool: "editDocument",
      toolCallId: part.toolCallId,
      output: "Document edited successfully.",
    },
  };
}

/**
 * Fold every tool call not present in `processedToolCallIds` into `document`,
 * in transcript order, so an edit sees the document as left by an earlier write.
 */
export function applyDocumentToolCalls(opts: {
  messages: DocumentAgentMessage[];
  document: string | undefined;
  processedToolCallIds: ReadonlySet<string>;
}): DocumentToolCallOutcome {
  let current = opts.document;
  const processed: string[] = [];
  const outputs: DocumentToolOutput[] = [];
  for (const part of unprocessedDocumentToolCalls(
    opts.messages,
    opts.processedToolCallIds
  )) {
    processed.push(part.toolCallId);
    const folded = foldDocumentToolCall(current, part);
    current = folded.document;
    outputs.push(folded.output);
  }
  return { document: current, processedToolCallIds: processed, outputs };
}

/**
 * The last in-flight `writeDocument` call, so the document panel can render
 * the article as the model types it: its id (a new id is a new write, which
 * replaces the document from scratch) and the content so far. Undefined when
 * nothing is streaming.
 */
export function getStreamingDocument(
  messages: DocumentAgentMessage[]
): { toolCallId: string; content: string } | undefined {
  // Only the last message is being streamed: a write left half-done in an
  // earlier one (a stopped turn) is not in flight.
  const last = messages.at(-1);
  if (last?.role !== "assistant") return undefined;
  let streaming: { toolCallId: string; content: string } | undefined;
  for (const part of last.parts) {
    if (
      part.type === "tool-writeDocument" &&
      part.state === "input-streaming" &&
      part.input?.content
    ) {
      streaming = { toolCallId: part.toolCallId, content: part.input.content };
    }
  }
  return streaming;
}
