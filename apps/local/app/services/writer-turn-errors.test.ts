/**
 * A writer turn run end to end on the server — agent, tools, UI message
 * stream — against the fake model, so each way a turn goes wrong is forced
 * deterministically. Asserts on what the browser receives.
 */
import { describe, expect, it } from "vitest";
import {
  readUIMessageStream,
  type ModelMessage,
  type UIMessageChunk,
} from "ai";
import {
  createDocumentWritingAgent,
  MAX_INVALID_TOOL_CALLS,
} from "./document-writing-agent";
import { createFakeWriterModel } from "./fake-writer-model";
import { describeWriterStreamError } from "./writer-stream-errors";
import {
  classifyChatError,
  findUnrecoveredToolError,
} from "@/features/article-writer/writer-errors";
import type { DocumentAgentMessage } from "@/features/article-writer/types";

let unique = 0;

async function runTurn(directive: string, text = `write it ${unique++}`) {
  const calls: Parameters<
    ReturnType<typeof createFakeWriterModel>["doStream"]
  >[0][] = [];
  const agent = createDocumentWritingAgent({
    model: createFakeWriterModel({ calls }),
    transcript: "",
    code: [],
    imageFiles: [],
  });
  // Unique text per run: the "-once" scenarios remember a message's text.
  const messages: ModelMessage[] = [
    { role: "user", content: `${directive} ${text}` },
  ];
  const result = await agent.stream({ messages });
  const [forMessage, forChunks] = result
    .toUIMessageStream({ onError: describeWriterStreamError })
    .tee();

  let message: DocumentAgentMessage | undefined;
  for await (const m of readUIMessageStream<DocumentAgentMessage>({
    stream: forMessage,
    onError: () => {},
  })) {
    message = m;
  }
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of forChunks) chunks.push(chunk);
  return { message: message!, chunks, calls };
}

const documentToolParts = (message: DocumentAgentMessage) =>
  message.parts.filter((p) => p.type === "tool-writeDocument");

describe("a writer turn with malformed tool input", () => {
  it("hands the validation error back to the model, which corrects itself in the same reply", async () => {
    const { message, calls } = await runTurn("[fake:bad-tool-shape]");

    const [rejected, accepted] = documentToolParts(message);
    expect(rejected).toMatchObject({ state: "output-error" });
    expect(rejected && "errorText" in rejected && rejected.errorText).toMatch(
      /writeDocument input failed validation: content/
    );
    expect(accepted).toMatchObject({
      state: "input-available",
      input: { content: expect.stringContaining("Fake draft") },
    });

    // The second model call saw the rejection as an error tool result.
    const toolMessage = calls[1]!.prompt.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMessage)).toMatch(/Invalid input for tool/);

    expect(findUnrecoveredToolError([message])).toBeNull();
  });

  it("gives up after a bounded number of tries, and the turn surfaces as a failure", async () => {
    const { message, calls } = await runTurn("[fake:bad-tool-shape-always]");

    expect(calls).toHaveLength(MAX_INVALID_TOOL_CALLS);
    expect(documentToolParts(message)).toHaveLength(MAX_INVALID_TOOL_CALLS);
    expect(findUnrecoveredToolError([message])).toMatch(
      /writeDocument input failed validation/
    );
  });
});

describe("a writer turn the API fails", () => {
  const streamError = (chunks: UIMessageChunk[]) => {
    const error = chunks.find((c) => c.type === "error");
    return error && "errorText" in error
      ? classifyChatError(error.errorText)
      : undefined;
  };

  it("names an overloaded API, and the retry of the same message succeeds", async () => {
    const first = await runTurn("[fake:overloaded-once]", "retry me");
    expect(streamError(first.chunks)).toEqual({
      kind: "overloaded",
      message: expect.stringContaining("overloaded"),
    });

    const retry = await runTurn("[fake:overloaded-once]", "retry me");
    expect(streamError(retry.chunks)).toBeUndefined();
    expect(documentToolParts(retry.message)).toHaveLength(1);
  });

  it("names a rate limit", async () => {
    const { chunks } = await runTurn("[fake:rate-limit-once]");
    expect(streamError(chunks)?.kind).toBe("rate-limited");
  });

  it("names a rejected request", async () => {
    const { chunks } = await runTurn("[fake:bad-request]");
    expect(streamError(chunks)).toEqual({
      kind: "bad-request",
      message: expect.stringContaining("messages: bad shape"),
    });
  });

  it("names a stream that dies mid-reply", async () => {
    const { chunks } = await runTurn("[fake:stream-drop-once]");
    expect(streamError(chunks)?.kind).toBe("network");
  });
});
