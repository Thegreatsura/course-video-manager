import path from "node:path";
import { wakeSpacedesk } from "../app/spacedesk-wake";
import { RECORDER_SERVICE_PORT } from "./protocol";
import { startRecorderService } from "./recorder-service";
import { startWindowsClock } from "./windows-clock";
import { windowsLauncher } from "./windows-launcher";

/**
 * The recorder service's process. Started detached by
 * `ensure-recorder-service.ts` (from `pnpm dev` / `pnpm start`), so stopping
 * or restarting the app never stops a recording; see ADR 0034.
 */

/** `.data/` at the repository root: gitignored, beside the app's own logs. */
const STATE_DIR = path.resolve(
  import.meta.dirname,
  "../../../.data/recorder-service"
);

const log = (message: string) =>
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);

export const runRecorderService = async () => {
  const clock = await startWindowsClock();
  const service = await startRecorderService({
    port: RECORDER_SERVICE_PORT,
    launch: windowsLauncher,
    now: clock.now,
    stateDir: STATE_DIR,
    wakeSpacedesk: () => wakeSpacedesk(),
  });
  log(
    `recorder service listening on ws://127.0.0.1:${service.port} (pid ${process.pid})`
  );

  // A deliberate stop (kill, Ctrl-C in its own terminal) closes the files
  // with `q` first, so a stopped service never leaves a half-written file.
  await new Promise<void>((resolve) => {
    const stop = (signal: string) => {
      log(`${signal}: stopping`);
      void service.close().finally(() => {
        clock.stop();
        resolve();
      });
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
  });
};
