import { Console, Effect } from "effect";
import type { Route } from "./+types/api.videos.$videoId.reveal";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import { CoursePublishService } from "@/services/course-publish-service";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Converts a WSL path to a Windows path using wslpath
 */
const wslPathToWindows = (wslPath: string): Effect.Effect<string, Error> => {
  return Effect.tryPromise({
    try: async () => {
      const { stdout } = await execAsync(`wslpath -w "${wslPath}"`);
      return stdout.trim();
    },
    catch: (e) => new Error(`Failed to convert path: ${e}`),
  });
};

/**
 * Opens Windows Explorer with the file selected.
 * explorer.exe commonly returns non-zero exit codes even on success,
 * so we ignore exit code errors and only fail on actual execution errors.
 */
const revealInExplorer = (windowsPath: string): Effect.Effect<void, Error> => {
  return Effect.async<void, Error>((resume) => {
    const command = `powershell.exe -c "explorer.exe '/select,\\"${windowsPath}\\"'"`;
    exec(command, (error) => {
      // explorer.exe returns non-zero exit codes even on success,
      // so only treat spawn/permission errors (string error codes like ENOENT)
      // as real failures, not numeric exit codes
      if (error && typeof error.code === "string") {
        resume(
          Effect.fail(new Error(`Failed to reveal file: ${error.message}`))
        );
      } else {
        resume(Effect.succeed(undefined));
      }
    });
  });
};

export const action = async (args: Route.ActionArgs) => {
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const publishService = yield* CoursePublishService;
    const exportPath = yield* publishService.resolveExportPath(videoId);

    if (!exportPath) {
      return yield* Effect.die(
        data("No exported file for this video", { status: 404 })
      );
    }

    // Convert WSL path to Windows path
    const windowsPath = yield* wslPathToWindows(exportPath);

    // Reveal in Windows Explorer
    yield* revealInExplorer(windowsPath);

    return { success: true };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll((e) => {
      Console.error(`Error revealing video: ${e}`);
      return Effect.die(data("Failed to reveal file", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
