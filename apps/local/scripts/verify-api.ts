/**
 * A verify-cvm run's own `apps/remote`: the deployed API's Hono app, served on
 * 127.0.0.1 against the run's test clone and nothing else. `verify.sh cvm`
 * starts it (once per run) and points the worktree's `cvm` at it, so a `cvm`
 * change is checked end to end — CLI, HTTP, bearer auth, the services — without
 * a request ever leaving this machine.
 *
 *   node --import tsx scripts/verify-api.ts <state file>
 *
 * Environment: DATABASE_URL (the clone) and CVM_VERIFY_CLONE (its name). Both
 * are checked by the same rule `cvm` uses (`checkVerifyClone`) before a
 * connection is opened: a non-loopback host or a database other than the
 * named per-run clone is refused, and the process exits 1.
 *
 * On start it mints a token IN THE CLONE (one day, named for the clone) and
 * writes `{ port, token, pid }` to <state file>, mode 0600. The token exists
 * only in that clone's api_tokens table, so it authenticates nowhere else, and
 * it dies with the clone on cleanup.
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createApp } from "@cvm/remote/app";
import type { RemoteRuntime } from "@cvm/remote/runtime";
import { domainServicesLayer } from "@cvm/core/layer";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import { ApiTokenOperationsService } from "@cvm/core/services/db-api-token-operations.server";
import { GitWorktreeProbeLive } from "@cvm/core/git-worktree";
import { Effect, Layer, ManagedRuntime } from "effect";
import { checkVerifyClone, VERIFY_CLONE_ENV_KEY } from "@/cli/verify-clone";
import { scriptDatabaseUrl } from "./script-database-url";

const fail = (message: string): never => {
  process.stderr.write(`verify-api: ${message}\n`);
  process.exit(1);
};

const stateFile = process.argv[2] ?? fail("usage: verify-api.ts <state file>");

// The API's own URL is not known yet, so the check is given a loopback
// stand-in for it; the server below only ever binds 127.0.0.1.
const verdict = checkVerifyClone({
  clone: process.env[VERIFY_CLONE_ENV_KEY],
  apiUrl: "http://127.0.0.1/",
  databaseUrl: scriptDatabaseUrl().url,
});
if (!verdict.ok) fail(`refusing to start: ${verdict.reason}`);
const clone = (verdict as { clone: string }).clone;

// The worktree connection guard stays on: it allows a loopback clone and
// nothing remote, whatever else this process was handed.
const runtime: RemoteRuntime = ManagedRuntime.make(
  domainServicesLayer.pipe(
    Layer.provideMerge(
      DrizzleService.Default.pipe(Layer.provide(GitWorktreeProbeLive))
    )
  )
);

const minted = await runtime.runPromise(
  Effect.flatMap(ApiTokenOperationsService, (tokens) =>
    tokens.mint({
      name: `verify-cvm ${clone}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
  )
);

const app = createApp(runtime);

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value])
        headers.append(key, v);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const response = await app.fetch(
      new Request(`http://127.0.0.1${req.url ?? "/"}`, {
        method: req.method,
        headers,
        body: hasBody ? Buffer.concat(chunks) : undefined,
      })
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (cause) {
    process.stderr.write(`verify-api: ${String(cause)}\n`);
    res.writeHead(500).end();
  }
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  writeFileSync(
    stateFile,
    JSON.stringify({ port, token: minted.secret, pid: process.pid }) + "\n",
    { mode: 0o600 }
  );
  process.stdout.write(
    `verify-api: serving clone ${clone} on http://127.0.0.1:${port}\n`
  );
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
