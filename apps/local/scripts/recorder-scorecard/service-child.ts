import { startRecorderService } from "../../recorder-service/recorder-service";
import { stopCleanlyOn } from "../../recorder-service/run-recorder-service";
import {
  startWindowsClock,
  type ClockTicker,
} from "../../recorder-service/windows-clock";
import { syntheticLauncher } from "./synthetic-launcher";
import {
  setRunTag,
  spawnPowerShellIdle,
  useIdleLauncher,
} from "./windows-idle";

/**
 * The real recorder service in a process of its own, as `service-process.ts`
 * runs it, on the scorecard's synthetic launcher, a free port and the run's
 * own state folder: so the scorecard can kill it mid-take and start it again.
 *
 *   node --import tsx service-child.ts <marker> <stateDir> <idle-launch.exe>
 *
 * Prints `SCORECARD-SERVICE-PORT <port>` once it listens.
 */
const [marker, stateDir, idleLaunch] = process.argv.slice(2);
if (!marker || !stateDir || !idleLaunch) {
  console.error(
    "Usage: service-child.ts <marker> <stateDir> <idle-launch.exe>"
  );
  process.exit(2);
}
useIdleLauncher(idleLaunch);
setRunTag(marker);

/** The Windows clock's PowerShell ticker, as `windows-clock.ts` runs it, at Idle on cores 6-9. */
const idleTicker = (): ClockTicker => {
  const child = spawnPowerShellIdle(
    "while ($true) { [Console]::Out.WriteLine([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 20 }"
  );
  return {
    onData: (listener) =>
      void child.stdout?.on("data", (d: Buffer) => listener(d.toString())),
    onEnd: (listener) => {
      let ended = false;
      const end = (reason: string) => {
        if (ended) return;
        ended = true;
        listener(reason);
      };
      child.once("error", (e) => end(`failed: ${e.message}`));
      child.once("exit", (code, signal) =>
        end(`exited with ${code ?? signal}`)
      );
    },
    kill: () => void child.kill(),
  };
};
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const clock = await startWindowsClock({ spawnTicker: idleTicker });
const service = await startRecorderService({
  port: 0,
  launch: syntheticLauncher({ marker }),
  now: clock.now,
  stateDir,
  wakeSpacedesk: () =>
    Promise.reject(new Error("The scorecard records Landscape only.")),
});
console.log(`SCORECARD-SERVICE-PORT ${service.port}`);
try {
  await stopCleanlyOn(service, process, (line) =>
    console.log(`scorecard service: ${line}`)
  );
} finally {
  clock.stop();
}
process.exit(0);
