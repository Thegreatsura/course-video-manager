import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { isMainCheckout } from "../live-desk/live-desk";
import { RECORDER_SERVICE_PORT, type RecorderState } from "./protocol";
import { RECORDER_SERVICE_LOG } from "./run-recorder-service";

/**
 * `dev:recorder-service` and `start:recorder-service`: runs the recorder
 * service for as long as `pnpm dev` / `pnpm start` runs, and stops it when
 * they stop (ADR 0035). No watch: a file save must never end a take, so a
 * change to the service is picked up on the next `pnpm dev`.
 *
 * The service runs as this script's child, in a process group of its own,
 * because turbo SIGKILLs a task's process group about 10 s after Ctrl-C and a
 * take may need longer to close its files. A stop (Ctrl-C, SIGTERM, pnpm
 * stopping a sibling that failed) is passed on as SIGTERM, and this waits for
 * the service to stop its take cleanly and exit. If this script is killed
 * first, the service notices its IPC channel close and stops cleanly all the
 * same: it never outlives `pnpm dev` by more than closing its files.
 *
 * Main checkout only, like the Stream Deck forwarder: the service holds
 * Matt's camera, screen and mic, and a worktree's or a verify-cvm clone's
 * service would take its port.
 *
 * Every refusal exits 0: pnpm stops every `dev:*` process when one fails, and
 * the app is still useful without the recorder.
 */

const SERVICE_PROCESS = path.join(import.meta.dirname, "service-process.ts");
const OLD_SERVICE_STOP_TIMEOUT_MS = 60_000;

type Health =
  | { service: "recorder"; pid: number; state?: RecorderState }
  | "nothing"
  | "something-else";

const health = () =>
  new Promise<Health>((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port: RECORDER_SERVICE_PORT,
        path: "/health",
        timeout: 2000,
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body) as {
              service?: string;
              pid?: number;
              state?: RecorderState;
            };
            resolve(
              parsed.service === "recorder"
                ? {
                    service: "recorder",
                    pid: parsed.pid ?? 0,
                    state: parsed.state,
                  }
                : "something-else"
            );
          } catch {
            resolve("something-else");
          }
        });
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", (e: NodeJS.ErrnoException) =>
      resolve(e.code === "ECONNREFUSED" ? "nothing" : "something-else")
    );
  });

const loud = (lines: string[]) => {
  const bar = "!".repeat(78);
  console.log(["", bar, ...lines.map((l) => `!! ${l}`), bar, ""].join("\n"));
};

/**
 * Frees the port of a recorder service left running from before ADR 0035
 * (it was started detached and outlived `pnpm dev`), or says why it cannot.
 * One that is recording is never stopped.
 */
const freeThePort = async (): Promise<boolean> => {
  const running = await health();
  if (running === "nothing") return true;
  if (running === "something-else") {
    loud([
      `RECORDER SERVICE NOT STARTED: something else answers on port ${RECORDER_SERVICE_PORT}.`,
      "Find it with `ss -ltnp | grep " +
        RECORDER_SERVICE_PORT +
        "`, stop it, then restart `pnpm dev`.",
    ]);
    return false;
  }
  const { pid, state } = running;
  if (state?.kind === "recording" || !pid) {
    loud([
      `RECORDER SERVICE NOT STARTED: an older recorder service (pid ${pid || "unknown"}) is on port ${RECORDER_SERVICE_PORT}` +
        (state?.kind === "recording" ? " and it is RECORDING." : "."),
      "It was left alone, so its take is safe, and the app keeps talking to it.",
      "It is left over from when the recorder service ran detached (ADR 0034).",
      `When the take is done: stop \`pnpm dev\`, run \`kill ${pid || "<pid>"}\` (it closes its files first;`,
      `\`curl http://127.0.0.1:${RECORDER_SERVICE_PORT}/health\` gives the pid), then start \`pnpm dev\` again.`,
    ]);
    return false;
  }
  console.log(
    `A recorder service from before ADR 0035 is on port ${RECORDER_SERVICE_PORT} (pid ${pid}) and is not recording: ` +
      "stopping it so this `pnpm dev` runs its own. It closes its files first."
  );
  try {
    process.kill(pid, "SIGTERM");
  } catch (e) {
    loud([
      `RECORDER SERVICE NOT STARTED: could not stop the old one (pid ${pid}): ${e instanceof Error ? e.message : String(e)}.`,
      `Stop it yourself (\`kill ${pid}\`), then restart \`pnpm dev\`.`,
    ]);
    return false;
  }
  const deadline = Date.now() + OLD_SERVICE_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await health()) === "nothing") {
      console.log(`The old recorder service (pid ${pid}) has stopped.`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  loud([
    `RECORDER SERVICE NOT STARTED: the old one (pid ${pid}) did not stop within ${OLD_SERVICE_STOP_TIMEOUT_MS / 1000} s.`,
    "It was not killed. Check it, then restart `pnpm dev`.",
  ]);
  return false;
};

/** Runs the service until it exits; resolves with this script's exit code. */
const runService = () =>
  new Promise<number>((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", SERVICE_PROCESS],
      {
        // A process group of its own: out of reach of turbo's SIGKILL.
        detached: true,
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        cwd: import.meta.dirname,
        env: process.env,
      }
    );
    let stopping = false;
    const onSignal = (signal: NodeJS.Signals) => () => {
      if (stopping) {
        console.log(
          `recorder service: ${signal} again; still closing the take's files. It finishes even if this script is killed.`
        );
        return;
      }
      stopping = true;
      console.log(
        `recorder service: ${signal}: stopping it (any take is stopped and its files closed). Its log: ${RECORDER_SERVICE_LOG}`
      );
      child.kill("SIGTERM");
    };
    for (const s of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.on(s, onSignal(s));
    child.on("exit", (code, signal) => {
      if (stopping || code === 0) return resolve(0);
      loud([
        `THE RECORDER SERVICE STOPPED (${signal ?? `exit ${code}`}). The rest of \`pnpm dev\` carries on without it.`,
        "Restart `pnpm dev` to start it again; a take it cut off is repaired when it starts.",
        `Its log: ${RECORDER_SERVICE_LOG}`,
      ]);
      resolve(0);
    });
  });

const main = async () => {
  if (!isMainCheckout(process.cwd())) {
    console.log(
      "Recorder service not started: this is not the main checkout of the repo. " +
        `It holds Matt's camera, screen and mic (port ${RECORDER_SERVICE_PORT}) and runs only from his main checkout.`
    );
    return 0;
  }
  if (!(await freeThePort())) return 0;
  return runService();
};

process.exit(await main());
