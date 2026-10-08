import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Data, Effect } from "effect";

/**
 * The app server's side of the Sidecar's Unix socket (`apps/local/sidecar/socket.ts`).
 * The app never runs a Job; it enqueues one as a row and asks the sidecar to
 * look (`nudge`), and it passes the sidecar's Job Event stream and Job logs
 * through to the browser.
 */

export class SidecarUnreachableError extends Data.TaggedError(
  "SidecarUnreachableError"
)<{ readonly socket: string; readonly message: string }> {}

/** The checkout root: the nearest directory above `from` with `pnpm-workspace.yaml`. */
const findCheckoutRoot = (from: string): string => {
  let dir = path.resolve(from);
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
};

/**
 * Where this checkout's sidecar listens: `CVM_SIDECAR_SOCKET` (verify-cvm sets
 * it to its run's socket), else `<checkout>/.data/sidecar.sock`, the default
 * `run-sidecar.ts` uses too.
 */
export const sidecarSocketPath = (): string =>
  process.env.CVM_SIDECAR_SOCKET ||
  path.join(findCheckoutRoot(process.cwd()), ".data", "sidecar.sock");

/** One request to the sidecar; resolves with the response, unread. */
export const requestSidecar = (opts: {
  readonly socket: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal | null;
}): Promise<http.IncomingMessage> =>
  new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: opts.socket,
      method: opts.method,
      path: opts.path,
      headers: opts.headers,
      timeout: 3_000,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    req.on("response", (res) => {
      // A stream stays open for as long as the browser listens: the timeout
      // was for answering at all.
      req.setTimeout(0);
      resolve(res);
    });
    req.on("timeout", () =>
      req.destroy(new Error("the sidecar did not answer in 3s"))
    );
    req.on("error", reject);
    req.end();
  });

const readAll = (res: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => (text += chunk));
    res.on("end", () => resolve(text));
    res.on("error", reject);
  });

/**
 * Ask the sidecar to look for work now. Best effort: a sidecar that is down
 * finds the Job when it starts, so a failed nudge is logged, never an error.
 */
export const nudgeSidecar = Effect.fn("nudgeSidecar")(function* () {
  const socket = sidecarSocketPath();
  yield* Effect.tryPromise({
    try: () =>
      requestSidecar({
        socket,
        method: "POST",
        path: "/nudge",
        headers: {},
        signal: null,
      }).then((res) => readAll(res)),
    catch: (cause) =>
      new SidecarUnreachableError({ socket, message: String(cause) }),
  }).pipe(
    Effect.catchTag("SidecarUnreachableError", (e) =>
      Effect.logWarning(
        `sidecar: could not nudge it at ${e.socket} (${e.message}); the Job waits until it runs`
      )
    )
  );
});

/** A Job's log as the sidecar keeps it, or `null` when it has none. */
export const readJobLog = Effect.fn("readJobLog")(function* (jobId: string) {
  const socket = sidecarSocketPath();
  const answer = yield* Effect.tryPromise({
    try: async () => {
      const res = await requestSidecar({
        socket,
        method: "GET",
        path: `/jobs/${encodeURIComponent(jobId)}/log`,
        headers: {},
        signal: null,
      });
      return { status: res.statusCode ?? 0, text: await readAll(res) };
    },
    catch: (cause) =>
      new SidecarUnreachableError({ socket, message: String(cause) }),
  });
  if (answer.status === 404) return null;
  const body = yield* Effect.try({
    try: () => JSON.parse(answer.text) as { log?: unknown },
    catch: () =>
      new SidecarUnreachableError({
        socket,
        message: `the sidecar answered ${answer.status} with something that is not JSON`,
      }),
  });
  if (answer.status !== 200 || typeof body.log !== "string") {
    return yield* new SidecarUnreachableError({
      socket,
      message: `the sidecar answered ${answer.status}`,
    });
  }
  return body.log;
});
