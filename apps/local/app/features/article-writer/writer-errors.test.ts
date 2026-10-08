import { describe, expect, it } from "vitest";
import {
  classifyChatError,
  encodeWriterError,
  findUnrecoveredToolError,
} from "./writer-errors";
import type { DocumentAgentMessage } from "./types";

const assistant = (
  parts: DocumentAgentMessage["parts"]
): DocumentAgentMessage => ({ id: "a", role: "assistant", parts });

const rejected = {
  type: "tool-writeDocument",
  toolCallId: "1",
  state: "output-error",
  input: undefined,
  errorText: "writeDocument input failed validation: content",
} as DocumentAgentMessage["parts"][number];

const accepted = {
  type: "tool-writeDocument",
  toolCallId: "2",
  state: "input-available",
  input: { content: "# Draft" },
} as DocumentAgentMessage["parts"][number];

describe("classifyChatError", () => {
  it("reads back the kind the server tagged", () => {
    expect(
      classifyChatError(encodeWriterError("rate-limited", "slow down"))
    ).toEqual({ kind: "rate-limited", message: "slow down" });
  });

  it("names an untagged response body as a server failure", () => {
    expect(classifyChatError("Internal Server Error")).toEqual({
      kind: "server",
      message: "Internal Server Error",
    });
  });
});

describe("findUnrecoveredToolError", () => {
  it("is null when the model corrected a rejected call later in the reply", () => {
    expect(findUnrecoveredToolError([assistant([rejected, accepted])])).toBe(
      null
    );
  });

  it("is the error when the reply ended on a rejected call", () => {
    expect(findUnrecoveredToolError([assistant([accepted, rejected])])).toBe(
      "writeDocument input failed validation: content"
    );
  });
});
