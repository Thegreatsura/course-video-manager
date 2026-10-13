import { execFile } from "node:child_process";
import { Effect } from "effect";
import {
  parseDirtyQueryOutput,
  windowsDriveOf,
  type DirtyBitReader,
  type VolumeDirtyBit,
} from "./dirty-bit";

const QUERY_TIMEOUT_MS = 5_000;

const runQuery = (command: string, args: readonly string[]) =>
  Effect.async<VolumeDirtyBit>((resume) => {
    const child = execFile(
      command,
      [...args],
      { timeout: QUERY_TIMEOUT_MS, windowsHide: true },
      (_error, stdout, stderr) => {
        // A non-zero exit (access denied) still prints why; parse it all.
        resume(Effect.succeed(parseDirtyQueryOutput(`${stdout}\n${stderr}`)));
      }
    );
    return Effect.sync(() => {
      child.kill();
    });
  });

/**
 * The real reader, through WSL interop. Two read-only queries, in order:
 * `fsutil dirty query <drive>` (the dirty bit itself; it may need an elevated
 * prompt), then `chkntfs <drive>` with no switches, which only DISPLAYS
 * whether the drive is dirty. Never pass chkntfs a switch: `/c`, `/x`, `/d`
 * and `/t` change what Windows does at boot. A root that is not a Windows
 * drive is `unknown`.
 */
export const windowsDirtyBitReader: DirtyBitReader = (root) => {
  const drive = windowsDriveOf(root);
  if (drive === null) return Effect.succeed("unknown");
  return runQuery("fsutil.exe", ["dirty", "query", drive]).pipe(
    Effect.flatMap((bit) =>
      bit === "unknown" ? runQuery("chkntfs.exe", [drive]) : Effect.succeed(bit)
    )
  );
};
