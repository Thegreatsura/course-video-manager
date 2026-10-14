import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { recordingSessions } from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { RecordingSessionEvent } from "recorder-service/protocol";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import { ingestRecorderEvent } from "./ingest.server";
import { createRecorderEventSequencer } from "./sequencer";

/**
 * A Recording Session remembers the Video Format it was filmed in and whether
 * it captured the screen, from `recording-started` (PGlite). A recorder
 * service from before Shorts sends neither: Landscape, screen captured.
 */

setupClipServiceTests();

const SESSION = "11111111-2222-3333-4444-555555555555";
const DIR = "/mnt/d/recordings/2026-10-12 11111111";

/** One `recording-started`, through the sequencer as the client feeds it. */
const ingest = (event: RecordingSessionEvent) =>
  Effect.runPromise(
    ingestRecorderEvent(
      testDb as never,
      createRecorderEventSequencer().accept(event).ready[0]!,
      async () => null
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          JobOperationsService.Default,
          ClipOperationsService.Default
        ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as never)))
      )
    )
  );

const started = (
  videoId: string,
  extra: Pick<
    Extract<RecordingSessionEvent, { type: "recording-started" }>,
    "format" | "screenCaptured"
  >
): RecordingSessionEvent => ({
  type: "recording-started",
  seq: 1,
  recordingSessionId: SESSION,
  videoId,
  t0Ms: 1_760_000_000_000,
  silenceLength: "short",
  files: {
    camera: `${DIR}/camera.mkv`,
    screen: `${DIR}/screen.mkv`,
    mic: `${DIR}/mic.mkv`,
  },
  ...extra,
});

const savedSession = () =>
  testDb.query.recordingSessions.findFirst({
    where: eq(recordingSessions.id, SESSION),
    columns: { format: true, screenCaptured: true, screenFilePath: true },
  });

describe("recorder ingest of a Recording Session's format", () => {
  it("stores a camera-only Short session as filmed", async () => {
    const video = await clipService.createVideo("A Short");
    await ingest(started(video.id, { format: "short", screenCaptured: false }));
    expect(await savedSession()).toEqual({
      format: "short",
      screenCaptured: false,
      screenFilePath: `${DIR}/screen.mkv`,
    });
  });

  it("stores an event without them as Landscape with its screen", async () => {
    const video = await clipService.createVideo("A Landscape Video");
    await ingest(started(video.id, {}));
    expect(await savedSession()).toMatchObject({
      format: "landscape",
      screenCaptured: true,
    });
  });
});
