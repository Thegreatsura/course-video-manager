import type { UIMessage } from "ai";

/**
 * Make a stored writer conversation safe to send back to Anthropic.
 *
 * Two kinds of tool part, both left behind by a turn that went wrong, used to
 * make EVERY later message in the conversation fail — the only way out was
 * Clear chat:
 *
 * - **A tool call with no result** (`input-available`). The writer's tools run
 *   in the browser, and a turn that failed, was stopped or was reloaded before
 *   the browser reported back leaves the call unanswered. The SDK refuses to
 *   build a prompt with an unanswered call (`MissingToolResultsError`). It is
 *   given an error result saying so.
 * - **A rejected call whose input is not an object** (`output-error` with
 *   unparseable JSON as `rawInput`). Anthropic requires a tool call's input to
 *   be an object, so that input becomes `{}`; the error result still tells
 *   the model what went wrong.
 *
 * `input-streaming` parts need nothing: the SDK leaves them out of the prompt.
 */
export function repairToolPartsForModel<M extends UIMessage>(
  messages: readonly M[]
): M[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    let changed = false;
    const parts = message.parts.map((part) => {
      const repaired = repairPart(part);
      if (repaired !== part) changed = true;
      return repaired;
    });
    return changed ? { ...message, parts } : message;
  });
}

type Part = UIMessage["parts"][number];

function repairPart(part: Part): Part {
  const isToolPart =
    part.type.startsWith("tool-") || part.type === "dynamic-tool";
  if (!isToolPart || !("state" in part)) return part;

  if (part.state === "input-available") {
    return {
      ...part,
      state: "output-error",
      errorText:
        "No result was recorded for this tool call: the turn ended before it was applied. Check <current-document> for the document's actual state.",
    } as Part;
  }

  if (part.state === "output-error") {
    const input = "input" in part ? part.input : undefined;
    const rawInput = "rawInput" in part ? part.rawInput : undefined;
    const effective = input ?? rawInput;
    if (typeof effective !== "object" || effective === null) {
      return { ...part, input: {}, rawInput: undefined } as Part;
    }
  }

  return part;
}
