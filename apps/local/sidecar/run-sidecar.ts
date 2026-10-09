import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cause, Deferred, Effect, Exit, Layer, Logger } from "effect";
import { resolveDatabaseUrl } from "@cvm/core/db/database-url";
import {
  formatConnectionRefusal,
  isReadOnlyConnection,
  judgeConnection,
} from "@cvm/core/db/connection-guard";
import { isInsideGitWorktree } from "@cvm/core/git-worktree";
import { leaveSignalsToTheProcess } from "@/services/ffmpeg-child-registry";
import { judgeServiceUrlOverrides } from "@/services/service-url-guard";
import { layerLive } from "@/services/layer.server";
import { SidecarContextLive } from "@/services/sidecar-context";
import { JOB_KINDS, type JobServices } from "./job-kinds";
import { makeJsonLogger } from "./json-logger";
import { runSidecar, SIDECAR_TIMING, type SidecarIdentity } from "./sidecar";
import { serveSidecarSocket } from "./socket";

/**
 * The sidecar's entry point (`pnpm dev` runs it as `dev:sidecar`, `pnpm start`
 * as `start:sidecar`), and its one Effect runtime boundary.
 *
 * EVERY EXIT IS 0. `pnpm dev` runs the app, the forwarder and this side by
 * side, and pnpm stops all of them when one fails — so a sidecar that cannot
 * run (a worktree pointed at production, a database not yet migrated, another
 * sidecar holding the lease) says why, loudly, and gets out of the app's way.
 * Nothing is lost while it is down: an enqueued Job is a row, and waits.
 */

const say = (message: string) =>
  process.stdout.write(`${new Date().toISOString()} [sidecar] ${message}\n`);

/** The checkout this file belongs to — its `.env`, `.data/` and git SHA. */
const CHECKOUT = path.resolve(import.meta.dirname, "../../..");

const gitSha = (): string => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: CHECKOUT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
};

/** Why the sidecar must not start here, or `undefined` when it may. */
const refusal = (): string | undefined => {
  const urls = judgeServiceUrlOverrides(process.env);
  if (urls.length > 0) {
    return `a service URL override would send production credentials to another host:\n${urls.map((r) => `  - ${r.message}`).join("\n")}`;
  }
  const url = resolveDatabaseUrl();
  if (!url) return "DATABASE_URL is not set, so there is no job table to read.";
  // The same rule every database client goes through (DrizzleService enforces
  // it again when it connects): a worktree never writes to a remote database.
  const verdict = judgeConnection({
    url,
    env: process.env,
    insideGitWorktree: () => isInsideGitWorktree(),
  });
  if (!verdict.allowed) return formatConnectionRefusal(verdict);
  // A read-only connection (verify-cvm's --production) cannot hold a lease.
  if (isReadOnlyConnection(url, process.env)) {
    return "the database connection is read-only, and the sidecar must write its lease and its Jobs.";
  }
  return undefined;
};

const main = async (): Promise<void> => {
  // The repo-root .env, as the app reads it. A variable already set wins
  // (verify-cvm sets DATABASE_URL to its clone and this never overrides it).
  const envFile = path.join(CHECKOUT, ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

  const refused = refusal();
  if (refused) {
    say(`not started: ${refused}`);
    return;
  }

  // Everything the run needs is read here, before any work starts.
  const socket =
    process.env.CVM_SIDECAR_SOCKET ||
    path.join(CHECKOUT, ".data", "sidecar.sock");
  const logDir =
    process.env.CVM_SIDECAR_LOG_DIR ||
    path.join(CHECKOUT, ".data", "logs", "jobs");
  fs.mkdirSync(path.dirname(socket), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const identity: SidecarIdentity = {
    holder: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    checkout: CHECKOUT,
    gitSha: gitSha(),
    socket,
  };

  // The sidecar owns its signals: a stop interrupts each running Job, whose
  // scope kills its ffmpeg, and the Job goes back to the queue. The registry's
  // own signal handler would SIGKILL ffmpeg first and re-raise the signal,
  // killing the process before any Job is put back.
  leaveSignalsToTheProcess();

  // The app server's own services, built once in this process as they are in
  // the app's (so ffmpeg's GPU/CPU permits are process-wide here too), on the
  // same guarded database client (`layerLive` includes the Job operations).
  // `SidecarContext` is provided here and nowhere else in the app: work that
  // has moved into a Job asks for it, so only the sidecar can run it.
  const layer = Layer.mergeAll(
    layerLive,
    SidecarContextLive,
    Logger.replace(
      Logger.defaultLogger,
      makeJsonLogger({ logDir, write: (text) => process.stdout.write(text) })
    )
  );

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const stop = yield* Deferred.make<string>();
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        // A signal handler cannot wait; completing a Deferred is synchronous.
        process.once(signal, () =>
          Deferred.unsafeDone(stop, Exit.succeed(signal))
        );
      }
      return yield* runSidecar<JobServices>({
        identity,
        registry: JOB_KINDS,
        timing: SIDECAR_TIMING,
        stop,
        serve: (handle) =>
          serveSidecarSocket({ socket, handle, registry: JOB_KINDS, logDir }),
      });
    }).pipe(Effect.provide(layer))
  );

  if (Exit.isSuccess(exit)) {
    const outcome = exit.value;
    if (outcome._tag === "LeaseHeld") {
      const lease = outcome.lease;
      say(
        lease
          ? `not started: the sidecar in ${lease.checkout} (pid ${lease.pid} on ${lease.hostname}, ${lease.gitSha.slice(0, 7)}) holds the lease on database ${lease.database}. One sidecar runs per database.`
          : "not started: another sidecar holds this database's lease."
      );
      return;
    }
    say(`stopped: ${outcome.reason}`);
    return;
  }
  say(
    `FAILED — the sidecar is not running. Jobs wait in the queue until it is.\n${Cause.pretty(exit.cause, { renderErrorCause: true })}`
  );
};

if (!process.env.VITEST) {
  main()
    .catch((error: unknown) =>
      say(`FAILED — the sidecar is not running.\n${String(error)}`)
    )
    .finally(() => {
      // The database pool's idle connections would hold the process open for
      // a while after the sidecar has stopped; nothing is left to wait for.
      setTimeout(() => process.exit(0), 250).unref();
    });
}
