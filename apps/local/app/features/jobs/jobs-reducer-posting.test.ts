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
  dependsOn: null,
});

const newTester = () =>
  new ReducerTester(jobsReducer, createInitialJobsState());

const row = (state: jobsReducer.State) => {
  const job = state.jobs[JOB_ID];
  return job ? jobUploadEntry(job) : null;
};

describe("jobsReducer", () => {
  describe("a post (decision 5: once, never on its own again)", () => {
    const EXPORT_ID = "6b0c1f5e-0000-4000-8000-0000000000ee";
    const postJob = wireJob({
      kind: "youtube",
      title: "Intro to Generics",
      maxAttempts: 1,
    });
    const post = (type: string, data: Record<string, unknown> = {}) =>
      streamed(wireEvent(type, data), postJob);
    const requestPost = (dependsOn: string | null): jobsReducer.Action => ({
      type: "job-requested",
      id: JOB_ID,
      kind: "youtube",
      title: "Intro to Generics",
      params: { videoId: "video-1" },
      subject: { type: "video", id: "video-1" },
      attemptsSpent: 0,
      dependsOn,
    });
    const requestExportFirst = (): jobsReducer.Action => ({
      type: "job-requested",
      id: EXPORT_ID,
      kind: "export",
      title: "Intro to Generics",
      params: { videoId: "video-1" },
      subject: { type: "video", id: "video-1" },
      attemptsSpent: 0,
      dependsOn: null,
    });
    const enqueued = (effects: jobsReducer.Effect[]) =>
      effects.flatMap((e) => (e.type === "enqueue-job" ? [e.id] : []));

    it("asked for with its export, is sent only once the export's row exists, and waits for it", () => {
      const tester = newTester()
        .send(requestExportFirst())
        .send(requestPost(EXPORT_ID));
      // The server refuses a dependsOn it has not seen: hold the post.
      expect(enqueued(tester.getEffects())).toEqual([EXPORT_ID]);

      tester.send({ type: "enqueue-succeeded", id: EXPORT_ID });
      expect(enqueued(tester.getEffects())).toEqual([EXPORT_ID, JOB_ID]);
      expect(
        tester
          .getEffects()
          .find((e) => e.type === "enqueue-job" && e.id === JOB_ID)
      ).toMatchObject({ dependsOn: EXPORT_ID });

      tester.send(post("queued", { dependsOn: EXPORT_ID }));
      expect(row(tester.getState())).toMatchObject({
        uploadType: "youtube",
        status: "waiting",
      });
    });

    it("fails with the export, without ever being sent, when the export's enqueue fails", () => {
      const tester = newTester()
        .send(requestExportFirst())
        .send(requestPost(EXPORT_ID))
        .send({ type: "enqueue-failed", id: EXPORT_ID, message: "boom" });
      expect(enqueued(tester.getEffects())).toEqual([EXPORT_ID]);
      expect(tester.getState().jobs[JOB_ID]).toMatchObject({
        status: "failed",
        errorMessage: 'Dependency "Intro to Generics" failed',
      });
    });

    it("draws its upload's progress and links the YouTube id it posted", () => {
      const tester = newTester()
        .send(requestPost(null))
        .send(post("queued"))
        .send(post("started", { attempt: 1 }))
        .send(post("progress", { stage: "uploading", percent: 40 }));
      expect(row(tester.getState())).toMatchObject({
        uploadType: "youtube",
        status: "uploading",
        progress: 40,
      });
      tester
        .send(post("posted", { youtubeVideoId: "yt-1" }))
        .send(post("succeeded"));
      expect(row(tester.getState())).toMatchObject({
        status: "success",
        progress: 100,
        youtubeVideoId: "yt-1",
      });
    });

    it("cut off, it waits for the author: the idle timer leaves it, it shows what the check found, and Retry asks the server", () => {
      const tester = newTester()
        .send(requestPost(null))
        .send(post("queued"))
        .send(post("started", { attempt: 1 }))
        .send(
          post("interrupted", {
            error: {
              tag: "JobInterrupted",
              message: "Interrupted — check before retrying",
            },
          })
        )
        .send(
          post("post-check", {
            verdict: "not-posted",
            detail: "It did not go out",
            url: null,
          })
        )
        .send({ type: "idle-timeout-elapsed" });
      expect(visibleJobs(tester.getState()).map((j) => j.id)).toEqual([JOB_ID]);
      expect(tester.getState().jobs[JOB_ID]).toMatchObject({
        status: "interrupted",
        errorTag: "JobInterrupted",
        postCheck: { verdict: "not-posted", detail: "It did not go out" },
      });

      tester.send({ type: "press-retry", id: JOB_ID });
      expect(tester.getEffects().at(-1)).toEqual({
        type: "retry-job",
        id: JOB_ID,
      });

      // The server re-queues the same row as its next attempt.
      tester.send(post("queued", { attempt: 2, retriedBy: "author" }));
      expect(tester.getState().jobs[JOB_ID]).toMatchObject({
        status: "queued",
        attempt: 2,
        errorMessage: null,
        postCheck: null,
      });
    });

    it("Retry does nothing for a kind that retries on its own, or a post that has not failed", () => {
      const tester = newTester()
        .send(requestExport())
        .send(streamed(wireEvent("failed", { error: { message: "x" } })))
        .send({ type: "press-retry", id: JOB_ID });
      expect(tester.getEffects().some((e) => e.type === "retry-job")).toBe(
        false
      );
    });
  });
});
