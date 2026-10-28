import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import type { WireJob, WireJobEvent } from "./job-wire";

const JOB_ID = "6b0c1f5e-0000-4000-8000-0000000000c1";
const CURSOR = 50;

const wireJob: WireJob = {
  id: JOB_ID,
  kind: "export",
  title: "Intro to Generics",
  attempt: 1,
  maxAttempts: 3,
  subjectType: "video",
  subjectId: "video-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const wireEvent = (
  id: number,
  type: string,
  data: Record<string, unknown> = {}
): WireJobEvent => ({
  id,
  jobId: JOB_ID,
  type,
  data,
  at: "2026-10-08T12:00:00.000Z",
});

const streamed = (event: WireJobEvent) => {
  const action = toJobsAction({ job: wireJob, event });
  if (!action) throw new Error(`no action for ${event.type}`);
  return action;
};

const snapshot = (
  jobs: { job: WireJob; events: WireJobEvent[] }[]
): jobsReducer.Action => ({
  type: "job-snapshot-received",
  snapshot: { cursor: CURSOR, jobs },
});

const failed = (id: number) =>
  streamed(wireEvent(id, "failed", { error: { message: "boom" } }));

const newTester = () =>
  new ReducerTester(jobsReducer, createInitialJobsState());

const failedToasts = (tester: ReturnType<typeof newTester>) =>
  tester.getEffects().filter((e) => e.type === "show-job-failed-toast");

describe("jobsReducer: which settlements are news", () => {
  it("a Job the catch-up replays, unknown to the tab, settles without a toast", () => {
    const tester = newTester().send(snapshot([]));
    tester.send(streamed(wireEvent(10, "started", { attempt: 1 })));
    tester.send(failed(11));
    expect(tester.getState().jobs[JOB_ID]).toMatchObject({ status: "failed" });
    expect(failedToasts(tester)).toEqual([]);
    expect(tester.getState().fromCatchUp[JOB_ID]).toBe(true);
    expect(tester.getState().joinedLate[JOB_ID]).toBe(true);
  });

  it("a Job the tab knew unfinished still toasts when it settles below the cursor", () => {
    const tester = newTester().send(
      snapshot([
        { job: wireJob, events: [wireEvent(10, "started", { attempt: 1 })] },
      ])
    );
    tester.send(failed(CURSOR - 1));
    expect(failedToasts(tester)).toHaveLength(1);
    expect(tester.getState().fromCatchUp[JOB_ID]).toBeUndefined();
  });

  it("a Job settling live, above the cursor, toasts", () => {
    const tester = newTester().send(snapshot([]));
    tester.send(streamed(wireEvent(CURSOR + 1, "queued")));
    tester.send(failed(CURSOR + 2));
    expect(failedToasts(tester)).toHaveLength(1);
    expect(tester.getState().joinedLate[JOB_ID]).toBeUndefined();
    expect(tester.getState().fromCatchUp[JOB_ID]).toBeUndefined();
  });
});

describe("jobsReducer: retry-failed", () => {
  it("toasts the Job's title with the server's message", () => {
    const tester = newTester().send(
      snapshot([
        { job: wireJob, events: [wireEvent(10, "started", { attempt: 1 })] },
      ])
    );
    tester.resetExec().send({
      type: "retry-failed",
      id: JOB_ID,
      message: "nope",
    });
    expect(tester.getEffects()).toEqual([
      {
        type: "show-retry-failed-toast",
        title: "Intro to Generics",
        message: "nope",
      },
    ]);
  });

  it("does nothing for a Job the tab does not know", () => {
    const tester = newTester().send({
      type: "retry-failed",
      id: "unknown",
      message: "nope",
    });
    expect(tester.getEffects()).toEqual([]);
  });
});
