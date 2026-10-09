import { Data, Effect } from "effect";
import { data } from "react-router";
import { CoursePublishReadService } from "@/services/course-publish-reads";
import { makeAction } from "@/services/route-action.server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

class WslPathConversionError extends Data.TaggedError(
  "WslPathConversionError"
)<{ readonly cause: unknown; readonly message: string }> {}

class RevealInExplorerError extends Data.TaggedError("RevealInExplorerError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

const wslPathToWindows = (
  wslPath: string
): Effect.Effect<string, WslPathConversionError> => {
  return Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("wslpath", ["-w", wslPath]);
      return stdout.trim();
    },
    catch: (e) =>
      new WslPathConversionError({
        cause: e,
        message: `Failed to convert path: ${e}`,
      }),
  });
};

const REVEAL_PATH_ENV = "CVM_REVEAL_PATH";

const revealInExplorer = (
  windowsPath: string
): Effect.Effect<void, RevealInExplorerError> => {
  return Effect.async<void, RevealInExplorerError>((resume) => {
    // The path reaches PowerShell as an environment variable (forwarded
    // into the Windows process by WSLENV), never spliced into the command
    // text, so nothing in a file name can be run as code.
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `explorer.exe ('/select,"' + $env:${REVEAL_PATH_ENV} + '"')`,
      ],
      {
        env: {
          ...process.env,
          [REVEAL_PATH_ENV]: windowsPath,
          // Only this variable crosses into the Windows process.
          WSLENV: REVEAL_PATH_ENV,
        },
      },
      (error) => {
        if (error && typeof error.code === "string") {
          resume(
            Effect.fail(
              new RevealInExplorerError({
                cause: error,
                message: `Failed to reveal file: ${error.message}`,
              })
            )
          );
        } else {
          resume(Effect.succeed(undefined));
        }
      }
    );
  });
};

export const action = makeAction({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const publishService = yield* CoursePublishReadService;
      const exportPath = yield* publishService.resolveExportPath(
        params.videoId!
      );

      if (!exportPath) {
        return yield* Effect.die(
          data("No exported file for this video", { status: 404 })
        );
      }

      const windowsPath = yield* wslPathToWindows(exportPath);
      yield* revealInExplorer(windowsPath);

      return { success: true };
    }),
});
