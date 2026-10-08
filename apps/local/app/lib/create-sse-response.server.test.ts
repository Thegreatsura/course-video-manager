import { describe, expect, it } from "vitest";
import {
  createSSEResponse,
  type SendEvent,
} from "./create-sse-response.server";
import { Cause, Effect, Layer, Logger, ManagedRuntime } from "effect";

const testRuntime = ManagedRuntime.make(Layer.empty);

/**
 * A runtime whose logger keeps what it is handed, so a test can read back what
 * the server would have printed — the log output is the boundary here.
 */
const makeLoggedRuntime = () => {
  const lines: { level: string; text: string }[] = [];
  const logger = Logger.make(({ logLevel, message, cause }) => {
    lines.push({
      level: logLevel.label,
      text: [String(message), Cause.pretty(cause)].join("\n"),
    });
  });
  return {
    lines,
    runtime: ManagedRuntime.make(Logger.replace(Logger.defaultLogger, logger)),
  };
};

async function readAllEvents(response: Response): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim()) events.push(part + "\n\n");
    }
  }
  return events;
}

describe("createSSEResponse", () => {
  it("returns correct SSE headers", () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.void,
    });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });

  it("formats events in correct SSE framing", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: (sendEvent) =>
        Effect.sync(() => {
          sendEvent("stage", { stage: "rendering" });
          sendEvent("complete", {});
        }),
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: stage\ndata: {"stage":"rendering"}\n\n',
      "event: complete\ndata: {}\n\n",
    ]);
  });

  it("closes the stream after program completes", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: (sendEvent) =>
        Effect.sync(() => {
          sendEvent("complete", {});
        }),
    });

    const reader = response.body!.getReader();
    const { done: firstDone } = await reader.read();
    expect(firstDone).toBe(false);

    const { done: secondDone } = await reader.read();
    expect(secondDone).toBe(true);
  });

  it("sends error event for tagged errors", async () => {
    class TestError {
      readonly _tag = "TestError";
      constructor(readonly detail: string) {}
    }

    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail(new TestError("something broke")),
      errorHandlers: [
        {
          tag: "TestError",
          handler: (e: TestError, sendEvent: SendEvent) => {
            sendEvent("error", { message: e.detail });
          },
        },
      ],
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: error\ndata: {"message":"something broke"}\n\n',
    ]);
  });

  it("sends fallback error event for untagged errors without message", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail({ code: 500 }),
      fallbackMessage: "Export failed unexpectedly",
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: error\ndata: {"message":"Export failed unexpectedly"}\n\n',
    ]);
  });

  it("uses error.message in fallback when available", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail({ message: "specific error text" }),
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: error\ndata: {"message":"specific error text"}\n\n',
    ]);
  });

  it("uses default fallback message when error has no message", async () => {
    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail({ code: 42 }),
    });

    const events = await readAllEvents(response);

    expect(events).toEqual([
      'event: error\ndata: {"message":"An unexpected error occurred"}\n\n',
    ]);
  });

  it("does not throw when the client disconnects mid-stream", async () => {
    let sendAfterCancel: (() => void) | undefined;

    const response = createSSEResponse({
      runtime: testRuntime,
      program: (sendEvent) =>
        Effect.async<void>((resume) => {
          sendEvent("stage", { stage: "rendering" });
          // Simulate the program still trying to emit after the client left.
          sendAfterCancel = () => {
            sendEvent("stage", { stage: "later" });
            resume(Effect.void);
          };
        }),
    });

    const reader = response.body!.getReader();
    await reader.read();
    // Client disconnects.
    await reader.cancel();

    // The program emitting and settling after cancel must not throw.
    expect(() => sendAfterCancel?.()).not.toThrow();
  });

  it("matches the first applicable tagged error handler", async () => {
    class FirstError {
      readonly _tag = "FirstError";
    }
    class SecondError {
      readonly _tag = "SecondError";
    }

    const response = createSSEResponse({
      runtime: testRuntime,
      program: () => Effect.fail(new SecondError()),
      errorHandlers: [
        {
          tag: "FirstError",
          handler: (_e: FirstError, sendEvent: SendEvent) => {
            sendEvent("error", { message: "first" });
          },
        },
        {
          tag: "SecondError",
          handler: (_e: SecondError, sendEvent: SendEvent) => {
            sendEvent("error", { message: "second" });
          },
        },
      ],
    });

    const events = await readAllEvents(response);

    expect(events).toEqual(['event: error\ndata: {"message":"second"}\n\n']);
  });

  describe("when the program fails or dies", () => {
    it("logs a defect with its cause and still tells the client", async () => {
      const { lines, runtime } = makeLoggedRuntime();

      const response = createSSEResponse({
        runtime,
        program: (sendEvent) =>
          Effect.sync(() => {
            sendEvent("stage", { stage: "rendering" });
            throw new Error(
              "Cannot read properties of undefined (reading 'fps')"
            );
          }),
      });

      const events = await readAllEvents(response);

      expect(events).toEqual([
        'event: stage\ndata: {"stage":"rendering"}\n\n',
        `event: error\ndata: {"message":"Cannot read properties of undefined (reading 'fps')"}\n\n`,
      ]);
      expect(lines).toEqual([
        {
          level: "ERROR",
          text: expect.stringContaining("reading 'fps'"),
        },
      ]);
    });

    it("sends the first line of a failure and logs the whole of it", async () => {
      const { lines, runtime } = makeLoggedRuntime();

      const response = createSSEResponse({
        runtime,
        program: () =>
          Effect.fail({
            message:
              "Overlay renderer exited with code 1: Error: Chromium could not start\n    at launch (browser.js:12)",
          }),
      });

      const events = await readAllEvents(response);

      expect(events).toEqual([
        'event: error\ndata: {"message":"Overlay renderer exited with code 1: Error: Chromium could not start"}\n\n',
      ]);
      expect(lines.map((line) => line.text).join("\n")).toContain(
        "at launch (browser.js:12)"
      );
    });
  });
});
