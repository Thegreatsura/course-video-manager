import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { placeSpeechAsClips } from "./clip-service-handler";
import {
  setupClipServiceTests,
  clipService,
  testDb,
  getItems,
  afterClip,
  start,
} from "./clip-service-test-setup";

setupClipServiceTests();

const MIC = "/mnt/d/recordings/session-1/mic.mkv";

const place = (input: Parameters<typeof placeSpeechAsClips>[1]) =>
  Effect.runPromise(
    placeSpeechAsClips(testDb as never, input).pipe(
      Effect.provide(
        JobOperationsService.Default.pipe(
          Layer.provide(Layer.succeed(DrizzleService, testDb as never))
        )
      )
    )
  );

const readJob = (jobId: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      return yield* ops.getJob(jobId);
    }).pipe(
      Effect.provide(
        JobOperationsService.Default.pipe(
          Layer.provide(Layer.succeed(DrizzleService, testDb as never))
        )
      )
    )
  );

const clipBounds = async (videoId: string) =>
  (await clipService.getTimeline(videoId)).flatMap((item) =>
    item.type === "clip"
      ? [
          {
            videoFilename: item.data.videoFilename,
            sourceStartTime: item.data.sourceStartTime,
            sourceEndTime: item.data.sourceEndTime,
          },
        ]
      : []
  );

describe("placeSpeechAsClips", () => {
  it("saves each speech segment as a Clip on the Footage file, padded at the end", async () => {
    const video = await clipService.createVideo("speech");

    await place({
      videoId: video.id,
      footagePath: MIC,
      insertionPoint: start,
      items: [],
      speech: [
        { startTime: 2, endTime: 5 },
        { startTime: 7.5, endTime: 12.25 },
      ],
    });

    expect(await clipBounds(video.id)).toEqual([
      { videoFilename: MIC, sourceStartTime: 2, sourceEndTime: 5.08 },
      { videoFilename: MIC, sourceStartTime: 7.5, sourceEndTime: 12.33 },
    ]);
  });

  it("drops speech shorter than the minimum Clip length", async () => {
    const video = await clipService.createVideo("speech");

    const result = await place({
      videoId: video.id,
      footagePath: MIC,
      insertionPoint: start,
      items: [],
      speech: [
        { startTime: 1, endTime: 1.6 },
        { startTime: 3, endTime: 4.5 },
      ],
    });

    expect(await clipBounds(video.id)).toEqual([
      { videoFilename: MIC, sourceStartTime: 3, sourceEndTime: 4.58 },
    ]);
    expect(result.clips).toHaveLength(1);
  });

  it("places the Clips at the editor's insertion point", async () => {
    const video = await clipService.createVideo("speech");
    const [first] = await clipService.appendClips({
      videoId: video.id,
      insertionPoint: start,
      items: [],
      clips: [
        { inputVideo: "first.mp4", startTime: 0, endTime: 1 },
        { inputVideo: "last.mp4", startTime: 0, endTime: 1 },
      ],
    });

    await place({
      videoId: video.id,
      footagePath: MIC,
      insertionPoint: afterClip(first!.id),
      items: await getItems(clipService, video.id),
      speech: [{ startTime: 10, endTime: 12 }],
    });

    expect((await clipBounds(video.id)).map((c) => c.videoFilename)).toEqual([
      "first.mp4",
      MIC,
      "last.mp4",
    ]);
  });

  it("enqueues one transcribe-clips Job for the new Clips", async () => {
    const video = await clipService.createVideo("speech");

    const result = await place({
      videoId: video.id,
      footagePath: MIC,
      insertionPoint: start,
      items: [],
      speech: [
        { startTime: 0, endTime: 2 },
        { startTime: 4, endTime: 6 },
      ],
    });

    const job = await readJob(result.transcriptionJobId!);
    expect(job).toMatchObject({
      kind: "transcribe-clips",
      status: "queued",
      subjectType: "video",
      subjectId: video.id,
      params: { clipIds: result.clips.map((c) => c.id) },
    });
    expect(
      (await clipService.getTimeline(video.id)).map(
        (item) => item.type === "clip" && item.data.transcriptionStatus
      )
    ).toEqual(["queued", "queued"]);
  });

  it("saves nothing and enqueues nothing when no speech is long enough", async () => {
    const video = await clipService.createVideo("speech");

    const result = await place({
      videoId: video.id,
      footagePath: MIC,
      insertionPoint: start,
      items: [],
      speech: [{ startTime: 0, endTime: 0.5 }],
    });

    expect(result).toEqual({ clips: [], transcriptionJobId: null });
    expect(await clipService.getTimeline(video.id)).toEqual([]);
  });
});
