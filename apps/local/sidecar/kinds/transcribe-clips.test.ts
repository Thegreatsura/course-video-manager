import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Data, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@cvm/core/db/schema";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import {
  type SidecarContext,
  SidecarContextTest,
} from "@/services/sidecar-context";
import { seedCourseVersion } from "@/test-utils/autofill-service-test-setup";
import type { JobContext } from "../job-kind";
import { CLIP_TRANSCRIPTION_POLICY } from "../retry-policy";
import {
  CLIP_TRANSCRIPTION_EVENTS,
  transcribeClipsJobKind,
} from "./transcribe-clips";

let testDb: TestDb;
let clipOpsLayer: Layer.Layer<ClipOperationsService>;
let videoId: string;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  clipOpsLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  const seeded = await seedCourseVersion(testDb, [
    { path: "01-intro", videos: [{}] },
  ]);
  videoId = Object.values(seeded.videoIds)[0]!;
});

class FakeWhisperError extends Data.TaggedError("FakeWhisperError")<{
  message: string;
}> {}

/** Whisper, faked: one word per Clip, and a refusal for `bad.mp4`. */
const fakeWhisper = Layer.succeed(WhisperTranscriptionService, {
  transcribeClips: (
    clips: ReadonlyArray<{ id: string; inputVideo: string }>
  ) =>
    clips[0]!.inputVideo === "bad.mp4"
      ? Effect.fail(
          new FakeWhisperError({ message: "Whisper API call failed: 500" })
        )
      : Effect.succeed(
          clips.map((clip) => ({
            id: clip.id,
            words: [{ start: 0, end: 1, text: `word-of-${clip.inputVideo}` }],
            segments: [{ start: 0, end: 1, text: `said ${clip.inputVideo}` }],
          }))
        ),
} as unknown as WhisperTranscriptionService);

const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | ClipOperationsService
    | WhisperTranscriptionService
    | NodeContext.NodeContext
    | SidecarContext
  >
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        clipOpsLayer,
        fakeWhisper,
        NodeContext.layer,
        SidecarContextTest
      )
    ),
    Effect.runPromise
  );

/** Fresh recordings, still `queued`, one per name. */
const seedClips = async (...inputVideos: string[]) => {
  const rows = await testDb
    .insert(schema.clips)
    .values(
      inputVideos.map((videoFilename, i) => ({
        videoId,
        videoFilename,
        sourceStartTime: i * 10,
        sourceEndTime: i * 10 + 5,
        order: `a${i}`,
        text: "",
        transcriptionStatus: "queued" as const,
      }))
    )
    .returning();
  return rows.map((row) => row.id);
};

const readClip = (id: string) =>
  testDb.query.clips.findFirst({
    where: (table, { eq }) => eq(table.id, id),
    with: { transcriptWords: true },
  });

const recordingContext = () => {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const ctx: JobContext = {
    jobId: "job-1",
    attempt: 1,
    maxAttempts: 1,
    enqueue: () => Effect.die("this kind starts no other Job"),
    emit: (type, data) =>
      Effect.sync(() => {
        events.push({ type, data });
      }),
  };
  return { ctx, events };
};

describe("the transcribe-clips Job kind", () => {
  it("runs once, in the default lane, as the editor's one request did", () => {
    expect({
      lane: transcribeClipsJobKind.lane,
      maxAttempts: transcribeClipsJobKind.maxAttempts,
    }).toEqual(CLIP_TRANSCRIPTION_POLICY);
    expect(CLIP_TRANSCRIPTION_POLICY).toEqual({
      lane: "default",
      maxAttempts: 1,
    });
  });

  it("stores each Clip's text and Transcript Words, and reports each Clip", async () => {
    const [a, b] = await seedClips("a.mp4", "b.mp4");
    const { ctx, events } = recordingContext();

    await run(transcribeClipsJobKind.runRaw({ clipIds: [a, b] }, ctx));

    for (const [id, name] of [
      [a!, "a.mp4"],
      [b!, "b.mp4"],
    ] as const) {
      const clip = await readClip(id);
      expect(clip).toMatchObject({
        transcriptionStatus: "done",
        text: `said ${name}`,
      });
      expect(clip!.transcribedAt).toBeInstanceOf(Date);
      expect(clip!.transcriptWords.map((w) => w.text)).toEqual([
        `word-of-${name}`,
      ]);
    }
    expect(
      [...events].sort((x, y) =>
        String(x.data.id).localeCompare(String(y.data.id))
      )
    ).toEqual(
      [
        {
          type: CLIP_TRANSCRIPTION_EVENTS.clipSettled,
          data: {
            id: a,
            transcriptionStatus: "done",
            text: "said a.mp4",
            hasTranscriptWords: true,
          },
        },
        {
          type: CLIP_TRANSCRIPTION_EVENTS.clipSettled,
          data: {
            id: b,
            transcriptionStatus: "done",
            text: "said b.mp4",
            hasTranscriptWords: true,
          },
        },
      ].sort((x, y) => String(x.data.id).localeCompare(String(y.data.id)))
    );
  });

  it("marks only the Clip Whisper refused as failed; the Job still succeeds", async () => {
    const [good, bad] = await seedClips("good.mp4", "bad.mp4");
    const { ctx, events } = recordingContext();

    await run(transcribeClipsJobKind.runRaw({ clipIds: [good, bad] }, ctx));

    expect(await readClip(good!)).toMatchObject({
      transcriptionStatus: "done",
    });
    expect(await readClip(bad!)).toMatchObject({
      transcriptionStatus: "failed",
    });
    expect(events).toContainEqual({
      type: CLIP_TRANSCRIPTION_EVENTS.clipSettled,
      data: { id: bad, transcriptionStatus: "failed" },
    });
  });

  it("refuses a request that names no Clip", async () => {
    const error = await Effect.runPromise(
      transcribeClipsJobKind.decodeParams({ clipIds: [] }).pipe(Effect.flip)
    );
    expect(error._tag).toBe("ParseError");
  });
});
