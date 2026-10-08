import { Cause } from "effect";

/**
 * Render an unknown failure as one string a human can read in a log file.
 *
 * Export failures arrive as tagged errors that wrap other errors: a
 * `OverlayContentRenderError` holds the subprocess failure, which holds the
 * spawn error. `String(cause)` shows only the outermost layer, and
 * `JSON.stringify` shows `{}` for anything extending `Error`, so both throw
 * away the one line that says what actually went wrong. This walks the chain
 * instead.
 *
 * It never throws. A formatter that fails while explaining a failure replaces
 * the information it exists to preserve.
 */
export const formatFailureCause = (
  cause: unknown,
  depth: number = 0
): string => {
  // Deep enough. A cycle (an error whose cause is itself) would otherwise
  // recurse until the stack gives out, inside error handling, where a second
  // failure is hardest to read.
  if (depth > 4) return "…";

  try {
    if (cause instanceof Error) {
      const head = cause.stack ?? `${cause.name}: ${cause.message}`;
      // `cause` is standard on Error and is also where Effect's tagged errors
      // put the thing they wrapped.
      const inner = (cause as { cause?: unknown }).cause;
      if (inner === undefined || inner === null) return head;
      return `${head}\ncaused by: ${formatFailureCause(inner, depth + 1)}`;
    }

    if (typeof cause === "string") return cause;

    // Effect's `Cause` and plain objects both land here. `JSON.stringify`
    // returns undefined for a function or a bare symbol, hence the fallback.
    return JSON.stringify(cause, null, 2) ?? String(cause);
  } catch {
    // A getter that throws, a BigInt, a circular plain object.
    return "[unformattable cause]";
  }
};

/**
 * The one line a toast shows for a failure: the first non-empty line of its
 * message, or `undefined` when it has none worth showing.
 *
 * A toast is where the author first learns something broke, so it should
 * name the actual cause ("Whisper API call failed: 401 …"), not the wrapper
 * that carried it. The rest — the stack, the renderer's whole stderr — goes
 * to the logs (`formatFailureCause`), not the screen.
 *
 * Takes an Effect `Cause` too, so a defect gets the same treatment as a
 * failure.
 */
export const failureHeadline = (failure: unknown): string | undefined => {
  const value = Cause.isCause(failure) ? Cause.squash(failure) : failure;
  const message =
    typeof value === "string"
      ? value
      : typeof value === "object" &&
          value !== null &&
          "message" in value &&
          typeof value.message === "string"
        ? value.message
        : undefined;
  const line = message
    ?.split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line === undefined || line === "" ? undefined : line;
};
