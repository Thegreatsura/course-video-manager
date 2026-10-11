import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { isMainCheckout } from "../live-desk/live-desk";
import { RECORDER_SERVICE_PORT } from "./protocol";

/**
 * Run by `pnpm dev` and `pnpm start` (`dev:recorder-service`,
 * `start:recorder-service`): start the recorder service if it is not already
 * running, DETACHED, and return. The app's own processes come and go with
 * every restart; the recorder service must not, because a restart would end a
 * recording mid-take (ADR 0034). So this never stops or restarts a running
 * service, even one started from older code: stop it by hand
 * (`kill <pid>`, which closes its files first) to pick up a change.
 *
 * Main checkout only, like the Stream Deck forwarder: the service holds
 * Matt's camera, screen and mic, and a worktree's or a verify-cvm clone's
 * service would take its port. Exits 0 either way so `pnpm dev` carries on.
 */

const LOG = path.resolve(
  import.meta.dirname,
  "../../../.data/logs/recorder-service.log"
);
const LAUNCHER = path.join(import.meta.dirname, "launch.mjs");
const START_TIMEOUT_MS = 30_000;

type Health = { service: string; pid: number } | "nothing" | "something-else";

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
            };
            resolve(
              parsed.service === "recorder"
                ? { service: parsed.service, pid: parsed.pid ?? 0 }
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

const main = async () => {
  if (!isMainCheckout(process.cwd())) {
    console.log(
      "Recorder service not started: this is not the main checkout of the repo. " +
        `It holds Matt's camera, screen and mic (port ${RECORDER_SERVICE_PORT}) and runs only from his main checkout.`
    );
    return;
  }
  const running = await health();
  if (typeof running === "object") {
    console.log(
      `Recorder service already running (pid ${running.pid}); left as it is.`
    );
    return;
  }
  if (running === "something-else") {
    console.log(
      `Recorder service not started: something else answers on port ${RECORDER_SERVICE_PORT}.`
    );
    return;
  }
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const out = fs.openSync(LOG, "a");
  const child = spawn(process.execPath, [LAUNCHER], {
    detached: true,
    stdio: ["ignore", out, out],
    cwd: import.meta.dirname,
    env: process.env,
  });
  child.unref();
  fs.closeSync(out);

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const now = await health();
    if (typeof now === "object") {
      console.log(
        `Recorder service started (pid ${now.pid}). Its log is ${LOG}`
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(
    `Recorder service did not answer within ${START_TIMEOUT_MS / 1000}s. Its log is ${LOG}`
  );
};

await main();
