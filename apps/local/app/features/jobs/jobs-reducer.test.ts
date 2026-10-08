import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import { jobUploadEntry, visibleJobs } from "./jobs-selectors";
import type { WireJob, WireJobEvent } from "./job-wire";

const JOB_ID = "6b0c1f5e-0000-4000-8000-000000000001";

const wireJob = (overrides: Partial<WireJob> = {}): WireJob => ({
  id: JOB_ID,
  kind: "export",
  title: "Intro to Generics",
  attempt: 1,
  maxAttempts: 3,
  subjectType: "video",
  subjectId: "video-1",
  ...overrides,
});

let nextEventId = 100;
const wireEvent = (
  type: string,
  data: Record<string, unknown> = {}
): WireJobEvent => ({
  id: ++nextEventId,
  jobId: JOB_ID,
  type,
  data,
  at: "2026-10-08T12:00:00.000Z",
});

/** A Job Event off the stream, as the bridge dispatches it. */
const streamed = (event: WireJobEvent, job: WireJob = wireJob()) => {
  const action = toJobsAction({ job, event });
  if (!action) throw new Error(`no action for ${event.type}`);
  return action;
};

const requestExport = (): jobsReducer.Action => ({
  type: "job-requested",
  id: JOB_ID,
  kind: "export",
  title: "Intro to Generics",
  params: { videoId: "video-1" },
  subject: { type: "video", id: "video-1" },
  attemptsSpent: 0,
});

const newTester = () =>
  new ReducerTester(jobsReducer, createInitialJobsState());

const row = (state: jobsReducer.State) => {
  const job = state.jobs[JOB_ID];
  return job ? jobUploadEntry(job) : null;
};

describe("jobsReducer", () => {
  it("an export the tab asks for is enqueued, then drawn from its Job Events until it succeeds", () => {
    const tester = newTester().send(requestExport());
    expect(row(tester.getState())).toMatchObject({
      status: "uploading",
      exportStage: "queued",
      progress: 0,
    });

    tester
      .send(streamed(wireEvent("queued")))
      .send(streamed(wireEvent("started", { attempt: 1 })))
      .send(streamed(wireEvent("stage", { stage: "concatenating-clips" })))
      .send(
        streamed(
          wireEvent("progress", { stage: "concatenating-clips", percent: 50 })
        )
      );
    // Concatenating owns 0–80 of the bar, exactly as the browser export drew it.
    expect(row(tester.getState())).toMatchObject({
      status: "uploading",
      exportStage: "concatenating-clips",
      progress: 40,
    });

    tester.send(streamed(wireEvent("succeeded", { attempt: 1 })));
    expect(row(tester.getState())).toMatchObject({
      status: "success",
      progress: 100,
    });
    expect(tester.getEffects()).toEqual([
      {
        type: "enqueue-job",
        id: JOB_ID,
        kind: "export",
        title: "Intro to Generics",
        params: { videoId: "video-1" },
        subject: { type: "video", id: "video-1" },
        attemptsSpent: 0,
      },
      {
        type: "show-job-succeeded-toast",
        jobId: JOB_ID,
        kind: "export",
        title: "Intro to Generics",
        subjectId: "video-1",
      },
      {
        type: "report-job-settled",
        jobId: JOB_ID,
        title: "Intro to Generics",
        outcome: "succeeded",
      },
    ]);
  });

  it("a failing export shows each retry, then toasts its last failure once, with its log", () => {
    const error = (message: string) => ({
      error: { tag: "ExportError", message, cause: message },
    });
    const tester = newTester()
      .send(streamed(wireEvent("queued")))
      .send(streamed(wireEvent("started", { attempt: 1 })))
      .send(
        streamed(
          wireEvent("retrying", {
            failedAttempt: 1,
            nextAttempt: 2,
            ...error("ffmpeg exited 1"),
          })
        )
      );
    expect(row(tester.getState())).toMatchObject({
      status: "retrying",
      retryCount: 1,
      errorMessage: "ffmpeg exited 1",
    });

    const failed = wireEvent("failed", {
      attempt: 3,
      ...error("Failed to composite Overlays"),
    });
    tester.send(streamed(failed));
    // The same event again (a snapshot and the live feed can both carry it).
    tester.send(streamed(failed));

    expect(row(tester.getState())).toMatchObject({
      status: "error",
      errorMessage: "Failed to composite Overlays",
    });
    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "export",
        title: "Intro to Generics",
        message: "Failed to composite Overlays",
        hasLog: true,
      },
      {
        type: "report-job-settled",
        jobId: JOB_ID,
        title: "Intro to Generics",
        outcome: "failed",
      },
    ]);
  });

  it("a reopened tab picks a running export up from the snapshot, without toasting what already happened", () => {
    const tester = newTester().send({
      type: "job-snapshot-received",
      snapshot: {
        cursor: 500,
        jobs: [
          {
            job: wireJob(),
            events: [
              wireEvent("queued"),
              wireEvent("started", { attempt: 1 }),
              wireEvent("stage", { stage: "normalizing-audio" }),
              wireEvent("progress", {
                stage: "normalizing-audio",
                percent: 0,
              }),
            ],
          },
          {
            job: wireJob({ id: "finished-earlier", title: "Old one" }),
            events: [wireEvent("succeeded")],
          },
        ],
      },
    });

    expect(row(tester.getState())).toMatchObject({
      status: "uploading",
      exportStage: "normalizing-audio",
      progress: 80,
    });
    expect(tester.getState().sidecar).toBe("running");

    tester.send(streamed(wireEvent("succeeded")));
    expect(tester.getEffects().map((e) => e.type)).toEqual([
      "show-job-succeeded-toast",
      "report-job-settled",
    ]);
  });

  it("a Job this tab followed that settled while the stream was down is announced when the snapshot shows it", () => {
    const tester = newTester()
      .send(streamed(wireEvent("queued")))
      .send(streamed(wireEvent("started", { attempt: 1 })))
      .send({
        type: "job-snapshot-received",
        snapshot: {
          cursor: 900,
          jobs: [
            {
              job: wireJob(),
              events: [
                wireEvent("queued"),
                wireEvent("started"),
                wireEvent("failed", { error: { message: "disk full" } }),
              ],
            },
          ],
        },
      });

    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "export",
        title: "Intro to Generics",
        message: "disk full",
        hasLog: true,
      },
      {
        type: "report-job-settled",
        jobId: JOB_ID,
        title: "Intro to Generics",
        outcome: "failed",
      },
    ]);
  });

  it("a Job put back by a stopping sidecar waits as queued, not as a retry, and carries on", () => {
    const tester = newTester()
      .send(streamed(wireEvent("queued")))
      .send(streamed(wireEvent("started", { attempt: 1 })))
      .send(streamed(wireEvent("requeued", { attempt: 1 })));
    expect(row(tester.getState())).toMatchObject({
      status: "uploading",
      exportStage: "queued",
      retryCount: 0,
    });
    tester.send(streamed(wireEvent("started", { attempt: 1 })));
    expect(row(tester.getState())?.status).toBe("uploading");
    expect(tester.getEffects()).toEqual([]);
  });

  it("an export asked for while the sidecar is down is still queued, and the author is told why it waits", () => {
    const tester = newTester()
      .send({ type: "sidecar-unavailable", message: "nothing on the socket" })
      .send(requestExport());
    expect(tester.getEffects().map((e) => e.type)).toEqual([
      "enqueue-job",
      "show-sidecar-not-running-toast",
    ]);
    expect(tester.getState().sidecar).toBe("not-running");
  });

  it("an enqueue the server refuses fails the row and anything waiting on it", () => {
    const tester = newTester()
      .send(requestExport())
      .resetExec()
      .send({ type: "enqueue-failed", id: JOB_ID, message: "HTTP 500" });
    expect(row(tester.getState())).toMatchObject({
      status: "error",
      errorMessage: "HTTP 500",
    });
    expect(tester.getEffects()).toEqual([
      {
        type: "show-job-failed-toast",
        jobId: JOB_ID,
        kind: "export",
        title: "Intro to Generics",
        message: "HTTP 500",
        hasLog: false,
      },
      {
        type: "report-job-settled",
        jobId: JOB_ID,
        title: "Intro to Generics",
        outcome: "failed",
      },
    ]);
  });

  it("dismissing hides a row; the idle timer hides only the finished ones", () => {
    const other = wireJob({ id: "other", title: "Still going" });
    const tester = newTester()
      .send(streamed(wireEvent("succeeded")))
      .send(streamed({ ...wireEvent("queued"), jobId: "other" }, other))
      .send({ type: "idle-timeout-elapsed" });
    expect(visibleJobs(tester.getState()).map((j) => j.id)).toEqual(["other"]);
    tester.send({ type: "press-dismiss", id: "other" });
    expect(visibleJobs(tester.getState())).toEqual([]);
  });

  describe("a vertical Shorts render", () => {
    const renderJob = wireJob({ kind: "render-vertical", title: "My Short" });
    const render = (type: string, data: Record<string, unknown> = {}) =>
      streamed(wireEvent(type, data), renderJob);

    it("draws as the render-vertical row it was in the browser, stage by stage, and releases the posts waiting on it", () => {
      const tester = newTester().send({
        type: "job-requested",
        id: JOB_ID,
        kind: "render-vertical",
        title: "My Short",
        params: { videoId: "video-1" },
        subject: { type: "video", id: "video-1" },
        attemptsSpent: 0,
      });
      expect(row(tester.getState())).toMatchObject({
        uploadType: "render-vertical",
        status: "uploading",
        renderVerticalStage: null,
        progress: 0,
      });

      tester
        .send(render("queued"))
        .send(render("started", { attempt: 1 }))
        .send(render("stage", { stage: "transcribing" }));
      // Each stage is a floor of the bar, as the browser render drew it.
      expect(row(tester.getState())).toMatchObject({
        status: "uploading",
        renderVerticalStage: "transcribing",
        progress: 30,
      });

      tester.send(render("stage", { stage: "compositing" }));
      expect(row(tester.getState())).toMatchObject({ progress: 85 });

      tester.send(render("succeeded"));
      expect(row(tester.getState())).toMatchObject({
        status: "success",
        progress: 100,
        renderVerticalStage: null,
      });
      expect(tester.getEffects()).toContainEqual({
        type: "report-job-settled",
        jobId: JOB_ID,
        title: "My Short",
        outcome: "succeeded",
      });
    });

    it("a render that fails every attempt toasts once, with its log, and fails the posts waiting on it", () => {
      const error = {
        error: {
          tag: "CouldNotTranscribeError",
          message: "Whisper API call failed: 401",
          cause: "Whisper API call failed: 401",
        },
      };
      const tester = newTester()
        .send(render("started", { attempt: 1 }))
        .send(render("retrying", { nextAttempt: 2, ...error }));
      expect(row(tester.getState())).toMatchObject({
        status: "retrying",
        retryCount: 1,
      });
      tester.send(render("failed", error));
      expect(row(tester.getState())).toMatchObject({
        status: "error",
        errorMessage: "Whisper API call failed: 401",
      });
      expect(tester.getEffects()).toEqual([
        {
          type: "show-job-failed-toast",
          jobId: JOB_ID,
          kind: "render-vertical",
          title: "My Short",
          message: "Whisper API call failed: 401",
          hasLog: true,
        },
        {
          type: "report-job-settled",
          jobId: JOB_ID,
          title: "My Short",
          outcome: "failed",
        },
      ]);
    });
  });
});
