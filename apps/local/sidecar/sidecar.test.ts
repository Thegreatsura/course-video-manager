import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger, Schema } from "effect";
import {
  JobOperationsService,
  type Job,
} from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { defineJobKind } from "./job-kind";
import { enqueueJob, JOB_KINDS, type JobKindRegistry } from "./job-kinds";
import { makeJsonLogger } from "./json-logger";
import { runSidecar, type SidecarTiming } from "./sidecar";
import { serveSidecarSocket } from "./socket";

let testDb: TestDb;
let dir: string;
let logDir: string;
let stdout: string[];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-sidecar-"));
  logDir = path.join(dir, "jobs");
  fs.mkdirSync(logDir);
  stdout = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const layer = () =>
  Layer.mergeAll(
    JobOperationsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, testDb as any))
    ),
    Logger.replace(
      Logger.defaultLogger,
      makeJsonLogger({ logDir, write: (text) => stdout.push(text) })
    )
  );

const TIMING: SidecarTiming = {
  leaseMs: 2_000,
  leaseRenewMs: 500,
  jobLeaseMs: 2_000,
  jobHeartbeatMs: 500,
  pollMs: 50,
  recoverEveryMs: 1_000,
  lapseWaitMs: 200,
};

/** Start a sidecar in the background; resolves once its socket answers. */
const startSidecar = (
  registry: JobKindRegistry,
  name = "first",
  timing: SidecarTiming = TIMING
) =>
  Effect.gen(function* () {
    const stop = yield* Deferred.make<string>();
    const socket = path.join(dir, `${name}.sock`);
    const serving = yield* Deferred.make<void>();
    const fiber = yield* Effect.fork(
      runSidecar({
        identity: {
          holder: `${name}-holder`,
          pid: process.pid,
          hostname: "test",
          checkout: `/checkouts/${name}`,
          gitSha: "abc1234",
          socket,
        },
        registry,
        timing,
        stop,
        serve: (handle) =>
          serveSidecarSocket({ socket, handle, registry }).pipe(
            Effect.zipRight(Deferred.succeed(serving, undefined))
          ),
      })
    );
    yield* Effect.raceFirst(
      Deferred.await(serving),
      Fiber.join(fiber).pipe(Effect.asVoid)
    );
    return { stop, fiber, socket };
  });

const request = (socket: string, method: string, url: string, body?: unknown) =>
  Effect.tryPromise(
    () =>
      new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = http.request(
          {
            socketPath: socket,
            method,
            path: url,
            headers: { "content-type": "application/json" },
          },
          (res) => {
            let text = "";
            res.on("data", (c) => (text += c));
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) })
            );
          }
        );
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      })
  );

const waitForJob = (id: string, done: (job: Job) => boolean) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    for (let i = 0; i < 200; i++) {
      const job = yield* ops.getJob(id);
      if (job && done(job)) return job;
      yield* Effect.sleep(25);
    }
    return yield* Effect.dieMessage(
      `job ${id} never reached the expected state`
    );
  });

const finished = (job: Job) => !["queued", "running"].includes(job.status);

const enqueue = (
  registry: JobKindRegistry,
  kind: string,
  params: unknown,
  title = kind
) =>
  enqueueJob({ kind, title, params, dependsOn: null, subject: null, registry });

const logLines = (jobId: string) =>
  fs
    .readFileSync(path.join(logDir, `${jobId}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/** Kinds that record how many of themselves run at once. */
const concurrencyProbe = () => {
  let now = 0;
  let max = 0;
  const kind = (lane: "default" | "publish") =>
    defineJobKind({
      lane,
      maxAttempts: 1,
      params: Schema.Struct({}),
      run: () =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            now++;
            max = Math.max(max, now);
          }),
          () => Effect.sleep(150),
          () => Effect.sync(() => now--)
        ),
    });
  return {
    registry: {
      "probe-default": kind("default"),
      "probe-publish": kind("publish"),
    },
    max: () => max,
  };
};

describe("the sidecar", () => {
  it.live(
    "runs a Job enqueued over its socket, records its events, and logs it to the Job's own file",
    () =>
      Effect.gen(function* () {
        const { stop, fiber, socket } = yield* startSidecar(JOB_KINDS);

        const health = yield* request(socket, "GET", "/health");
        expect(health.body).toMatchObject({
          ok: true,
          checkout: "/checkouts/first",
        });

        const enqueued = yield* request(socket, "POST", "/jobs", {
          kind: "noop",
          title: "a test job",
          params: { durationMs: 100 },
        });
        expect(enqueued.status).toBe(201);
        const id: string = enqueued.body.job.id;

        const job = yield* waitForJob(id, finished);
        expect(job.status).toBe("succeeded");
        const read = yield* request(socket, "GET", `/jobs/${id}`);
        const types: string[] = read.body.events.map(
          (e: { type: string }) => e.type
        );
        expect(types[0]).toBe("queued");
        expect(types).toContain("progress");
        expect(types.at(-1)).toBe("succeeded");

        const lines = logLines(id);
        expect(lines.map((l) => l.message)).toContain("job succeeded");
        expect(
          lines.every(
            (l) => l.jobId === id && l.kind === "noop" && l.attempt === 1
          )
        ).toBe(true);

        yield* Deferred.succeed(stop, "test over");
        expect(yield* Fiber.join(fiber)).toEqual({
          _tag: "Stopped",
          reason: "test over",
        });
        expect(fs.existsSync(socket)).toBe(false);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "refuses a Job of an unknown kind, or with bad params, at the socket",
    () =>
      Effect.gen(function* () {
        const { stop, fiber, socket } = yield* startSidecar(JOB_KINDS);
        const unknown = yield* request(socket, "POST", "/jobs", {
          kind: "nope",
          title: "x",
        });
        const bad = yield* request(socket, "POST", "/jobs", {
          kind: "noop",
          title: "x",
          params: { durationMs: "soon" },
        });
        expect([unknown.status, bad.status]).toEqual([400, 400]);
        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "retries a failing Job at once until its attempts run out, and logs every failure with its cause",
    () =>
      Effect.gen(function* () {
        // Polling slower than the test waits: only the nudges can get it done.
        const { stop, fiber, socket } = yield* startSidecar(
          JOB_KINDS,
          "first",
          {
            ...TIMING,
            pollMs: 60_000,
          }
        );
        const enqueued = yield* request(socket, "POST", "/jobs", {
          kind: "noop",
          title: "fails",
          params: { failAttempts: 99 },
        });
        const job: Job = enqueued.body.job;

        const done = yield* waitForJob(job.id, finished);
        expect(done).toMatchObject({
          status: "failed",
          attempt: 3,
          error: { tag: "NoopJobFailedError" },
        });
        const failures = logLines(job.id).filter(
          (l) => l.message === "job failed"
        );
        expect(failures.map((l) => l.attempt)).toEqual([1, 2, 3]);
        expect(
          failures.every((l) => String(l.cause).includes("NoopJobFailedError"))
        ).toBe(true);

        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer()))
  );

  it.live("logs a defect in a handler and fails the Job with it", () =>
    Effect.gen(function* () {
      const registry = {
        broken: defineJobKind({
          lane: "default",
          maxAttempts: 1,
          params: Schema.Struct({}),
          run: () => Effect.dieMessage("the renderer exploded"),
        }),
      };
      const { stop, fiber } = yield* startSidecar(registry);
      const job = yield* enqueue(registry, "broken", {});

      const done = yield* waitForJob(job.id, finished);
      expect((done.error as { message: string }).message).toBe(
        "the renderer exploded"
      );
      expect(
        logLines(job.id).some((l) =>
          String(l.cause).includes("the renderer exploded")
        )
      ).toBe(true);

      yield* Deferred.succeed(stop, "test over");
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(layer()))
  );

  it.live(
    "runs one publish-lane Job at a time, and default-lane Jobs all at once",
    () =>
      Effect.gen(function* () {
        const publish = concurrencyProbe();
        const { stop, fiber } = yield* startSidecar(publish.registry);
        const publishes = yield* Effect.forEach([1, 2, 3], () =>
          enqueue(publish.registry, "probe-publish", {})
        );
        for (const p of publishes) yield* waitForJob(p.id, finished);
        expect(publish.max()).toBe(1);
        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);

        const unbounded = concurrencyProbe();
        const second = yield* startSidecar(unbounded.registry, "second");
        const defaults = yield* Effect.forEach([1, 2, 3], () =>
          enqueue(unbounded.registry, "probe-default", {})
        );
        for (const d of defaults) yield* waitForJob(d.id, finished);
        expect(unbounded.max()).toBe(3);
        yield* Deferred.succeed(second.stop, "test over");
        yield* Fiber.join(second.fiber);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "puts a Job it was running back in the queue as its next attempt when it is stopped",
    () =>
      Effect.gen(function* () {
        const { stop, fiber } = yield* startSidecar(JOB_KINDS);
        const job = yield* enqueue(JOB_KINDS, "noop", { durationMs: 60_000 });
        yield* waitForJob(job.id, (j) => j.status === "running");

        yield* Deferred.succeed(stop, "SIGTERM");
        yield* Fiber.join(fiber);

        const ops = yield* JobOperationsService;
        expect(yield* ops.getJob(job.id)).toMatchObject({
          status: "queued",
          attempt: 2,
        });
        expect(logLines(job.id).map((l) => l.message)).toContain(
          "job interrupted"
        );
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "on start, recovers a Job a dead sidecar left running, and runs it again",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const job = yield* enqueue(JOB_KINDS, "noop", {});
        yield* ops.claimNextJob({
          lane: "default",
          holder: "dead",
          leaseMs: 1,
        });
        yield* Effect.sleep(5);

        const { stop, fiber } = yield* startSidecar(JOB_KINDS);
        const done = yield* waitForJob(job.id, finished);
        expect(done).toMatchObject({ status: "succeeded", attempt: 2 });

        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "does not start beside a live sidecar on the same database, and names it",
    () =>
      Effect.gen(function* () {
        const first = yield* startSidecar(JOB_KINDS);
        const second = yield* startSidecar(JOB_KINDS, "second");

        expect(yield* Fiber.join(second.fiber)).toMatchObject({
          _tag: "LeaseHeld",
          lease: { checkout: "/checkouts/first" },
        });

        yield* Deferred.succeed(first.stop, "test over");
        yield* Fiber.join(first.fiber);
      }).pipe(Effect.provide(layer()))
  );
});
