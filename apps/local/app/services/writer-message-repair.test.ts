import { describe, expect, it } from "vitest";
import { convertToModelMessages, type UIMessage } from "ai";
import { repairToolPartsForModel } from "./writer-message-repair";

const conversation = (part: object): UIMessage[] => [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Write it" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [part as UIMessage["parts"][number]],
  },
  { id: "u2", role: "user", parts: [{ type: "text", text: "Again" }] },
];

describe("repairToolPartsForModel", () => {
  // Left unrepaired, every later message in the conversation failed.
  it("answers a tool call the browser never reported back on", async () => {
    const messages = conversation({
      type: "tool-writeDocument",
      toolCallId: "call-1",
      state: "input-available",
      input: { content: "# Draft" },
    });

    const model = await convertToModelMessages(
      repairToolPartsForModel(messages)
    );

    const result = model.find((m) => m.role === "tool");
    expect(result?.content).toEqual([
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-1",
        output: expect.objectContaining({ type: "error-text" }),
      }),
    ]);
  });

  it("gives a rejected call with unparseable input an object input", async () => {
    const messages = conversation({
      type: "tool-editDocument",
      toolCallId: "call-2",
      state: "output-error",
      input: undefined,
      rawInput: '{"edits": [',
      errorText: "bad JSON",
    });

    const model = await convertToModelMessages(
      repairToolPartsForModel(messages)
    );

    const assistant = model.find((m) => m.role === "assistant");
    expect(assistant?.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolCallId: "call-2",
        input: {},
      }),
    ]);
  });

  it("leaves a settled conversation untouched", () => {
    const messages = conversation({
      type: "tool-writeDocument",
      toolCallId: "call-3",
      state: "output-available",
      input: { content: "# Draft" },
      output: "Document written successfully.",
    });

    expect(repairToolPartsForModel(messages)).toEqual(messages);
  });
});
