import { APICallError, InvalidToolInputError, RetryError } from "ai";
import { encodeWriterError } from "@/features/article-writer/writer-errors";

/**
 * The `onError` of the writer's UI message stream: every error the stream
 * carries to the browser passes through here, and only the returned string
 * reaches it. The SDK's default is a bare "An error occurred.", which told
 * the user nothing and left them nothing to act on.
 *
 * Two kinds of error arrive:
 * - a tool call the model got wrong — its text becomes the rejected tool
 *   part's `errorText`, shown on that part; the model sees the SDK's own,
 *   fuller message in its next step;
 * - a stream error that ends the turn — tagged with its kind
 *   (`encodeWriterError`) so the client can name it and offer Retry.
 */
export function describeWriterStreamError(error: unknown): string {
  // Tool errors reach onError already flattened to their message.
  if (typeof error === "string") return summariseFlattenedToolError(error);

  if (InvalidToolInputError.isInstance(error)) {
    return `${error.toolName} input failed validation: ${summariseValidation(error)}`;
  }

  if (RetryError.isInstance(error)) {
    return describeWriterStreamError(error.lastError);
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const detail = anthropicMessage(error.responseBody) ?? error.message;
    if (status === 529 || /overloaded/i.test(error.responseBody ?? "")) {
      return encodeWriterError(
        "overloaded",
        `Anthropic is overloaded right now (${status ?? "529"}). Wait a moment, then retry.`
      );
    }
    if (status === 429) {
      return encodeWriterError(
        "rate-limited",
        `Anthropic's rate limit was hit (429): ${detail}`
      );
    }
    if (status === 401 || status === 403) {
      return encodeWriterError(
        "auth",
        `Anthropic rejected the API key (${status}): ${detail}`
      );
    }
    if (status !== undefined && status >= 500) {
      return encodeWriterError(
        "overloaded",
        `Anthropic had an error of its own (${status}): ${detail}`
      );
    }
    return encodeWriterError(
      "bad-request",
      `Anthropic rejected the request${status ? ` (${status})` : ""}: ${detail}`
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/terminated|socket|ECONN|fetch failed|network/i.test(message)) {
    return encodeWriterError(
      "network",
      `The connection to Anthropic dropped: ${message}`
    );
  }
  return encodeWriterError("server", message || "The writer failed.");
}

/** `{"error":{"message":"…"}}`, Anthropic's error body, or undefined. */
function anthropicMessage(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === "string" ? message : undefined;
  } catch {
    return undefined;
  }
}

type Issue = { path?: unknown[]; message?: string };

const formatIssues = (issues: Issue[]) =>
  issues
    .map((issue) => {
      const path = (issue.path ?? []).join(".");
      return path ? `${path}: ${issue.message}` : String(issue.message);
    })
    .join("; ");

/** The validation issues, without the (possibly article-sized) input value. */
function summariseValidation(error: InvalidToolInputError): string {
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    const issues = (cause as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return formatIssues(issues as Issue[]);
    cause = cause.cause;
  }
  return error.message.slice(0, 300);
}

const FLATTENED_INVALID_INPUT =
  /^Invalid input for tool (\w+): Type validation failed: Value: [\s\S]*?\nError message: ([\s\S]*)$/;

/**
 * The SDK's message for a rejected tool call, which the model reads, quotes
 * the whole input — an article, sometimes. The user gets the issues alone.
 */
function summariseFlattenedToolError(text: string): string {
  const match = FLATTENED_INVALID_INPUT.exec(text);
  if (!match) return text;
  try {
    const issues = JSON.parse(match[2]!) as unknown;
    if (Array.isArray(issues)) {
      return `${match[1]} input failed validation: ${formatIssues(issues as Issue[])}`;
    }
  } catch {
    // Not JSON: fall through to the plain message.
  }
  return `${match[1]} input failed validation: ${match[2]!.slice(0, 300)}`;
}
