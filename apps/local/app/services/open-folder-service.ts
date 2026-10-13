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

export class WslPathConversionError extends Data.TaggedError(
  "WslPathConversionError"
)<{ readonly cause: unknown; readonly message: string }> {}

export class RevealInExplorerError extends Data.TaggedError(
  "RevealInExplorerError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

const wslPathToWindowsForReveal = (
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

/**
 * Open Explorer with `wslPath` selected (Show in Explorer): the exported file
 * of a Video, or a file on the Storage pages. Opens a window; starts nothing
 * in the background.
 */
export const revealFileInExplorer = (
  wslPath: string
): Effect.Effect<void, WslPathConversionError | RevealInExplorerError> =>
  wslPathToWindowsForReveal(wslPath).pipe(Effect.flatMap(revealInExplorer));
