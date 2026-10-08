import fs from "node:fs";
import http from "node:http";
import { Data, Effect, Runtime, Schema } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { enqueueJob, type JobKindRegistry } from "./job-kinds";
import type { SidecarHandle } from "./sidecar";

/**
 * The sidecar's socket: HTTP over a Unix socket at `<checkout>/.data/sidecar.sock`
 * (or `CVM_SIDECAR_SOCKET`). A Unix socket, never a TCP port, so it can never
 * take a port in the CVM's 5170-5199 band or verify-cvm's 5200-5299, and two
 * checkouts never meet on it.
 *
 *   GET  /health     who this sidecar is, its database and its lanes
 *   POST /nudge      look for work now (an enqueue elsewhere calls this)
 *   POST /jobs       {kind, title, params, dependsOn?} → enqueue, then nudge
 *   GET  /jobs/<id>  the Job and its events
 */

export class SidecarSocketError extends Data.TaggedError("SidecarSocketError")<{
  readonly socket: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Linux's limit on a socket path (sun_path), less the terminating NUL. */
export const MAX_SOCKET_PATH_BYTES = 107;

const EnqueueRequest = Schema.Struct({
  kind: Schema.String,
  title: Schema.String,
  params: Schema.optionalWith(Schema.Unknown, { default: () => ({}) }),
  dependsOn: Schema.optionalWith(Schema.NullOr(Schema.String), {
    default: () => null,
  }),
});

class BadRequestError extends Data.TaggedError("BadRequestError")<{
  readonly message: string;
}> {}

const readBody = (req: http.IncomingMessage) =>
  Effect.async<string, BadRequestError>((resume) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () =>
      resume(Effect.succeed(Buffer.concat(chunks).toString("utf8")))
    );
    req.on("error", (error) =>
      resume(Effect.fail(new BadRequestError({ message: String(error) })))
    );
  });

const parseJson = (text: string) =>
  Effect.try({
    try: (): unknown => (text.trim() === "" ? {} : JSON.parse(text)),
    catch: () => new BadRequestError({ message: "the body is not JSON" }),
  });

/** Is something already answering on `socket`? */
const socketAnswers = (socket: string) =>
  Effect.async<boolean>((resume) => {
    const req = http.get({
      socketPath: socket,
      path: "/health",
      timeout: 1_000,
    });
    req.on("response", (res) => {
      res.resume();
      resume(Effect.succeed(true));
    });
    req.on("timeout", () => {
      req.destroy();
      resume(Effect.succeed(false));
    });
    req.on("error", () => resume(Effect.succeed(false)));
  });

/**
 * Listen on `socket` for as long as the scope lives. Refuses a path too long
 * for a socket, and a socket another live process still answers on; a socket
 * file left by a dead one is replaced.
 */
export const serveSidecarSocket = (opts: {
  readonly socket: string;
  readonly handle: SidecarHandle;
  readonly registry: JobKindRegistry;
}) =>
  Effect.gen(function* () {
    const { socket, handle, registry } = opts;
    if (Buffer.byteLength(socket) > MAX_SOCKET_PATH_BYTES) {
      return yield* new SidecarSocketError({
        socket,
        message: `the socket path is ${Buffer.byteLength(socket)} bytes; a Unix socket allows ${MAX_SOCKET_PATH_BYTES}. Set CVM_SIDECAR_SOCKET to a shorter path.`,
      });
    }
    if (fs.existsSync(socket)) {
      if (yield* socketAnswers(socket)) {
        return yield* new SidecarSocketError({
          socket,
          message: `another process already answers on ${socket}`,
        });
      }
      fs.rmSync(socket, { force: true });
    }

    const runtime = yield* Effect.runtime<JobOperationsService>();
    const run = Runtime.runPromiseExit(runtime);

    const route = (
      req: http.IncomingMessage
    ): Effect.Effect<
      { status: number; body: unknown },
      unknown,
      JobOperationsService
    > =>
      Effect.gen(function* () {
        const url = req.url ?? "/";
        if (req.method === "GET" && url === "/health") {
          return { status: 200, body: yield* handle.health };
        }
        if (req.method === "POST" && url === "/nudge") {
          yield* handle.nudge;
          return { status: 200, body: { ok: true } };
        }
        if (req.method === "POST" && url === "/jobs") {
          const request = yield* readBody(req).pipe(
            Effect.flatMap(parseJson),
            Effect.flatMap(Schema.decodeUnknown(EnqueueRequest))
          );
          const job = yield* enqueueJob({
            kind: request.kind,
            title: request.title,
            params: request.params,
            dependsOn: request.dependsOn,
            subject: null,
            registry,
          });
          yield* handle.nudge;
          return { status: 201, body: { ok: true, job } };
        }
        const jobMatch = /^\/jobs\/([^/?]+)$/.exec(url);
        if (req.method === "GET" && jobMatch?.[1]) {
          const ops = yield* JobOperationsService;
          const id = decodeURIComponent(jobMatch[1]);
          const job = yield* ops.getJob(id);
          if (!job)
            return {
              status: 404,
              body: { ok: false, message: `no job ${id}` },
            };
          return {
            status: 200,
            body: { ok: true, job, events: yield* ops.listJobEvents(id) },
          };
        }
        return {
          status: 404,
          body: { ok: false, message: `no such request: ${req.method} ${url}` },
        };
      }).pipe(
        Effect.catchTags({
          BadRequestError: (e) =>
            Effect.succeed({
              status: 400,
              body: { ok: false, message: e.message },
            }),
          ParseError: (e) =>
            Effect.succeed({
              status: 400,
              body: { ok: false, message: e.message },
            }),
          UnknownJobKindError: (e) =>
            Effect.succeed({
              status: 400,
              body: { ok: false, message: e.message },
            }),
        }),
        Effect.tapErrorCause((cause) =>
          Effect.logError(`socket: ${req.method} ${req.url} failed`, cause)
        )
      );

    const server = http.createServer((req, res) => {
      // runPromiseExit never rejects, and node's request callback cannot wait.
      void run(route(req)).then((exit) => {
        const answer =
          exit._tag === "Success"
            ? exit.value
            : {
                status: 500,
                body: { ok: false, message: "the sidecar failed; see its log" },
              };
        res.writeHead(answer.status, { "content-type": "application/json" });
        res.end(JSON.stringify(answer.body));
      });
    });

    yield* Effect.async<void, SidecarSocketError>((resume) => {
      server.once("error", (cause) =>
        resume(
          Effect.fail(
            new SidecarSocketError({ socket, message: String(cause), cause })
          )
        )
      );
      server.listen(socket, () => resume(Effect.void));
    });
    yield* Effect.addFinalizer(() =>
      Effect.async<void>((resume) => {
        server.close(() => resume(Effect.void));
        server.closeAllConnections();
      }).pipe(
        Effect.zipRight(Effect.sync(() => fs.rmSync(socket, { force: true }))),
        Effect.zipRight(Effect.logInfo("sidecar: socket closed"))
      )
    );
    yield* Effect.logInfo(`sidecar: listening on ${socket}`);
  });
