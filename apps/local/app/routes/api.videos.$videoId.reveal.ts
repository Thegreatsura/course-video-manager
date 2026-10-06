import { Data, Effect } from "effect";
import { data } from "react-router";
import { CoursePublishService } from "@/services/course-publish-service";
import { makeAction } from "@/services/route-action.server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
      const { stdout } = await execAsync(`wslpath -w "${wslPath}"`);
      return stdout.trim();
    },
    catch: (e) =>
      new WslPathConversionError({
        cause: e,
        message: `Failed to convert path: ${e}`,
      }),
  });
};

const revealInExplorer = (
  windowsPath: string
): Effect.Effect<void, RevealInExplorerError> => {
  return Effect.async<void, RevealInExplorerError>((resume) => {
    const command = `powershell.exe -c "explorer.exe '/select,\\"${windowsPath}\\"'"`;
    exec(command, (error) => {
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
    });
  });
};

export const action = makeAction({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const publishService = yield* CoursePublishService;
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
