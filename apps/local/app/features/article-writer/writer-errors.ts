/**
 * What can go wrong in a writer turn, as the chat sees it.
 *
 * The server never sends an error object, only a string (`errorText` on the
 * UI message stream, or a non-OK response body). It tags the string with the
 * kind it recognised — `[writer:overloaded] …` — so the client can say what
 * happened without re-parsing Anthropic's error bodies. A string with no tag
 * came from somewhere the server did not classify: the browser's fetch, or
 * the route failing before it streamed.
 */

import type { DocumentAgentMessage } from "./types";

export const WRITER_ERROR_KINDS = [
  /** Anthropic is overloaded (529) or had a 5xx of its own. */
  "overloaded",
  /** Anthropic's rate limit (429). */
  "rate-limited",
  /** The API key was rejected (401/403). */
  "auth",
  /** Anthropic refused the request as malformed (400). */
  "bad-request",
  /** The connection dropped — browser to server, or server to Anthropic. */
  "network",
  /** The model kept sending tool input that failed validation. */
  "invalid-tool-input",
  /** The route failed before streaming, or anything else unrecognised. */
  "server",
] as const;

export type WriterErrorKind = (typeof WRITER_ERROR_KINDS)[number];

export type WriterFailure = { kind: WriterErrorKind; message: string };

const TAG = /^\[writer:([a-z-]+)\]\s*/;

const isKind = (value: string): value is WriterErrorKind =>
  (WRITER_ERROR_KINDS as readonly string[]).includes(value);

/** The server's side: tag a message with its kind. */
export function encodeWriterError(
  kind: WriterErrorKind,
  message: string
): string {
  return `[writer:${kind}] ${message}`;
}

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network error|load failed|terminated|socket hang up|econnreset|err_network/i;

/** The client's side: read a chat error's message back into a failure. */
export function classifyChatError(raw: string): WriterFailure {
  const tagged = TAG.exec(raw);
  if (tagged && isKind(tagged[1]!)) {
    return { kind: tagged[1]!, message: raw.slice(tagged[0].length) };
  }
  if (NETWORK_PATTERN.test(raw)) {
    return {
      kind: "network",
      message: "The connection dropped before the reply finished.",
    };
  }
  const trimmed = raw.trim();
  return {
    kind: "server",
    message:
      trimmed.length > 0
        ? trimmed.slice(0, 400)
        : "The server failed without saying why.",
  };
}

export const FAILURE_TITLES: Record<WriterErrorKind, string> = {
  overloaded: "Anthropic is overloaded",
  "rate-limited": "Rate limited",
  auth: "API key rejected",
  "bad-request": "Request rejected",
  network: "Connection dropped",
  "invalid-tool-input": "The model's tool calls kept failing",
  server: "Something went wrong",
};

/**
 * The error text of a finished turn that ended on a rejected tool call.
 *
 * The server hands each rejected call back to the model and lets it try
 * again, a bounded number of times. A turn whose last tool call is still
 * rejected is one where the model gave up or ran out of tries: the document
 * did not change, and the user has to hear about it. Returns null for every
 * other turn.
 */
export function findUnrecoveredToolError(
  messages: readonly DocumentAgentMessage[]
): string | null {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return null;
  const toolParts = last.parts.filter(
    (part) => part.type.startsWith("tool-") || part.type === "dynamic-tool"
  );
  const lastTool = toolParts.at(-1);
  if (!lastTool || !("state" in lastTool)) return null;
  if (lastTool.state !== "output-error") return null;
  return "errorText" in lastTool && typeof lastTool.errorText === "string"
    ? lastTool.errorText
    : "The model's last tool call was rejected.";
}
