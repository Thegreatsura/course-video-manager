import { Data, Effect } from "effect";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class OpenFolderError extends Data.TaggedError("OpenFolderError")<{
  cause: unknown;
  message: string;
}> {}

const wslPathToWindows = (
  wslPath: string
): Effect.Effect<string, OpenFolderError> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("wslpath", ["-w", wslPath]);
      return stdout.trim();
    },
    catch: (e) =>
      new OpenFolderError({
        cause: e,
        message: `Failed to convert path: ${e}`,
      }),
  });

export class OpenFolderService extends Effect.Service<OpenFolderService>()(
  "OpenFolderService",
  {
    effect: Effect.gen(function* () {
      const openInExplorer = Effect.fn("openInExplorer")(function* (
        path: string
      ) {
        const windowsPath = yield* wslPathToWindows(path);
        yield* Effect.tryPromise({
          try: async () => {
            await execFileAsync("explorer.exe", [windowsPath]);
          },
          catch: (e) =>
            new OpenFolderError({
              cause: e,
              message: `Failed to open Explorer: ${e}`,
            }),
        });
      });

      const openInVSCode = Effect.fn("openInVSCode")(function* (path: string) {
        yield* Effect.tryPromise({
          try: async () => {
            await execFileAsync("code", [path]);
          },
          catch: (e) =>
            new OpenFolderError({
              cause: e,
              message: `Failed to open VS Code: ${e}`,
            }),
        });
      });

      return { openInExplorer, openInVSCode };
    }),
  }
) {}
