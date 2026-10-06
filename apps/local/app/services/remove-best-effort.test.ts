import { FileSystem } from "@effect/platform";
import { SystemError, type SystemErrorReason } from "@effect/platform/Error";
import { Effect, Logger, LogLevel } from "effect";
import { describe, expect, it } from "vitest";
import { removeBestEffort } from "./remove-best-effort";

const run = (remove: FileSystem.FileSystem["remove"]) => {
  const logs: Array<{ level: string; message: unknown }> = [];
  const logger = Logger.make(({ logLevel, message }) => {
    logs.push({ level: logLevel.label, message });
  });
  const fs = FileSystem.makeNoop({ remove });
  return Effect.runPromise(
    removeBestEffort(fs, "/tmp/scratch.mp4").pipe(
      Effect.either,
      Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
      Logger.withMinimumLogLevel(LogLevel.All)
    )
  ).then((result) => ({ result, logs }));
};

const failWith = (reason: SystemErrorReason) => () =>
  Effect.fail(
    new SystemError({
      reason,
      module: "FileSystem",
      method: "remove",
      pathOrDescriptor: "/tmp/scratch.mp4",
    })
  );

describe("removeBestEffort", () => {
  it("removes the file", async () => {
    const removed: string[] = [];
    const { result, logs } = await run((path) =>
      Effect.sync(() => {
        removed.push(path);
      })
    );
    expect(result._tag).toBe("Right");
    expect(removed).toEqual(["/tmp/scratch.mp4"]);
    expect(logs).toEqual([]);
  });

  it("is silent when the file is already gone", async () => {
    const { result, logs } = await run(failWith("NotFound"));
    expect(result._tag).toBe("Right");
    expect(logs).toEqual([]);
  });

  it("never fails, but logs any other failure as a warning", async () => {
    const { result, logs } = await run(failWith("PermissionDenied"));
    expect(result._tag).toBe("Right");
    expect(logs).toEqual([
      { level: "WARN", message: ["Could not remove /tmp/scratch.mp4"] },
    ]);
  });
});
