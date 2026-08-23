import { Data } from "effect";
import { describe, expect, it } from "vitest";
import { formatFailureCause } from "./format-failure-cause";

class RenderError extends Data.TaggedError("RenderError")<{
  cause: unknown;
  message: string;
}> {}

describe("formatFailureCause", () => {
  it("keeps the message of a tagged error", () => {
    const formatted = formatFailureCause(
      new RenderError({ cause: null, message: "the renderer exited with 1" })
    );

    expect(formatted).toContain("the renderer exited with 1");
  });

  it("walks down to the failure that started it", () => {
    const formatted = formatFailureCause(
      new RenderError({
        cause: new Error("ENOENT: no such file or directory, open bin.mjs"),
        message: "Failed to start the overlay renderer",
      })
    );

    expect(formatted).toContain("Failed to start the overlay renderer");
    expect(formatted).toContain("caused by:");
    expect(formatted).toContain("ENOENT");
  });

  it("reports a plain object, which JSON.stringify can show", () => {
    expect(
      formatFailureCause({ _tag: "ConfigError", key: "MISSING_KEY" })
    ).toContain("MISSING_KEY");
  });

  it("survives an error that is its own cause", () => {
    const looping = new Error("round and round");
    (looping as { cause?: unknown }).cause = looping;

    expect(() => formatFailureCause(looping)).not.toThrow();
    expect(formatFailureCause(looping)).toContain("round and round");
  });

  it("survives an object that cannot be stringified", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(formatFailureCause(circular)).toBe("[unformattable cause]");
  });
});
