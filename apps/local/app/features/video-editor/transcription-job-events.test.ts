import { describe, expect, it } from "vitest";
import type { JobEventMessage, WireJob } from "@/features/jobs/job-wire";
import { clipActionOfJobEvent } from "./transcription-job-events";

const scope = { videoId: "video-1", loadedThrough: 10 };

const transcriptionJob: WireJob = {
  id: "job-1",
  kind: "transcribe-clips",
  title: "Transcribe 2 Clips",
  attempt: 1,
  maxAttempts: 1,
  subjectType: "video",
  subjectId: "video-1",
};

const heard = (
  type: string,
  data: Record<string, unknown> = {},
  overrides: { job?: Partial<WireJob>; id?: number } = {}
): JobEventMessage => ({
  job: { ...transcriptionJob, ...overrides.job },
  event: {
    id: overrides.id ?? 11,
    jobId: "job-1",
    type,
    data,
    at: "2026-10-09T12:00:00.000Z",
  },
});

describe("clipActionOfJobEvent", () => {
  it("turns a Clip that landed into clips-transcribed", () => {
    expect(
      clipActionOfJobEvent(
        heard("clip-settled", {
          id: "clip-a",
          transcriptionStatus: "done",
          text: "Hello",
          hasTranscriptWords: true,
        }),
        scope
      )
    ).toEqual({
      type: "clips-transcribed",
      clips: [
        {
          databaseId: "clip-a",
          transcriptionStatus: "done",
          text: "Hello",
          hasTranscriptWords: true,
        },
      ],
    });
  });

  it("turns a Clip Whisper refused into a failed clips-transcribed", () => {
    expect(
      clipActionOfJobEvent(
        heard("clip-settled", { id: "clip-b", transcriptionStatus: "failed" }),
        scope
      )
    ).toEqual({
      type: "clips-transcribed",
      clips: [{ databaseId: "clip-b", transcriptionStatus: "failed" }],
    });
  });

  it("tells the editor which Clips the Job took on", () => {
    expect(
      clipActionOfJobEvent(
        heard("clips-started", { clipIds: ["clip-a", "clip-b"] }),
        scope
      )
    ).toEqual({
      type: "transcription-job-started",
      jobId: "job-1",
      clipIds: ["clip-a", "clip-b"],
    });
  });

  it.each(["failed", "interrupted"] as const)(
    "reports a Job that %s",
    (type) => {
      expect(clipActionOfJobEvent(heard(type), scope)).toEqual({
        type: "transcription-job-failed",
        jobId: "job-1",
      });
    }
  );

  // An older Job's result, replayed in a snapshot, must not overwrite what
  // the loader read (a newer Job's result, or that newer Job running).
  it("ignores an event the loader had already seen", () => {
    const settled = { id: "clip-a", transcriptionStatus: "failed" };
    expect(
      clipActionOfJobEvent(heard("clip-settled", settled, { id: 10 }), scope)
    ).toBeNull();
    expect(
      clipActionOfJobEvent(heard("failed", {}, { id: 3 }), scope)
    ).toBeNull();
  });

  it("ignores another Video's Job, another kind, and an event it cannot read", () => {
    const settled = { id: "clip-a", transcriptionStatus: "failed" };
    expect(
      clipActionOfJobEvent(
        heard("clip-settled", settled, { job: { subjectId: "video-2" } }),
        scope
      )
    ).toBeNull();
    expect(
      clipActionOfJobEvent(
        heard("clip-settled", settled, { job: { kind: "export" } }),
        scope
      )
    ).toBeNull();
    expect(
      clipActionOfJobEvent(heard("clip-settled", { id: 4 }), scope)
    ).toBeNull();
    expect(clipActionOfJobEvent(heard("started"), scope)).toBeNull();
  });
});
