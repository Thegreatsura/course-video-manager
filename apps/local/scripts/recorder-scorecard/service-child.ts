import { startRecorderService } from "../../recorder-service/recorder-service";
import { stopCleanlyOn } from "../../recorder-service/run-recorder-service";
import { startWindowsClock } from "../../recorder-service/windows-clock";
import { syntheticLauncher } from "./synthetic-launcher";

/**
 * The real recorder service in a process of its own, as `service-process.ts`
 * runs it, on the scorecard's synthetic launcher, a free port and the run's
 * own state folder: so the scorecard can kill it mid-take and start it again.
 *
 *   node --import tsx service-child.ts <marker> <stateDir>
 *
 * Prints `SCORECARD-SERVICE-PORT <port>` once it listens.
 */
const [marker, stateDir] = process.argv.slice(2);
if (!marker || !stateDir) {
  console.error("Usage: service-child.ts <marker> <stateDir>");
  process.exit(2);
}
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const clock = await startWindowsClock();
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
