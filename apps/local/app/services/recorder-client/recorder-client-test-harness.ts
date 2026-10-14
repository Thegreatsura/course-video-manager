import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, vi } from "vitest";
import { Effect, Layer } from "effect";
import {
  CALIBRATION,
  start,
  tmp,
} from "recorder-service/test-utils/service-harness";
import { fakeWindows } from "recorder-service/test-utils/fake-windows";
import { DrizzleService } from "@/services/drizzle-service.server";
import { avCalibrations } from "@/db/schema";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { clipService, testDb } from "../clip-service-test-setup";
import { lastPassedCalibration } from "../av-calibration.server";
import {
  createRecorderClient,
  type RecorderClientOptions,
} from "./client.server";
import {
  ingestRecorderEvent,
  unfinishedRecordingSessions,
} from "./ingest.server";

/**
 * The recorder client end to end, without hardware: the real recorder
 * service on a scripted Windows (its fake ffmpeg.exe, via the service's own
 * test harness, whose `afterEach` stops it), the app server's recorder
 * client, and the database on PGlite (the test file calls
 * `setupClipServiceTests()`).
 */

export { tmp };

const clients: { close: () => void }[] = [];
// Registered after the service harness's, so (after hooks run as a stack)
// clients close before the service they talk to.
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

/** The recorder service on a scripted Windows (`fakeWindows`, never the real Spacedesk). */
export const startService = async (
  stateDir = tmp(),
  windows = fakeWindows()
) => {
  const { port } = await start(windows, stateDir);
  return { windows, port, stateDir };
};

export type Ingest = RecorderClientOptions["ingest"];

/** The real ingest, on PGlite. */
export const saveEvent: Ingest = (event, askEditor) =>
  Effect.runPromise(
    ingestRecorderEvent(testDb as never, event, askEditor).pipe(
      Effect.provide(
        JobOperationsService.Default.pipe(
          Layer.provide(Layer.succeed(DrizzleService, testDb as never))
        )
      )
    )
  );

/** Where a Stream Deck Record's Recording Sessions go. */
export const STREAM_DECK_FOLDER = fs.mkdtempSync(
  path.join(os.tmpdir(), "recorder-client-deck-")
);
afterAll(() => fs.rmSync(STREAM_DECK_FOLDER, { recursive: true, force: true }));

export type LastPassed = RecorderClientOptions["calibration"];

/**
 * A fresh AV Calibration on the scripted mic, stored (a Recording Session
 * links it): every Record is let through.
 */
export const freshCalibration: LastPassed = async () => {
  await testDb
    .insert(avCalibrations)
    .values({
      id: CALIBRATION.id,
      createdAt: new Date(CALIBRATION.createdAtMs),
      outcome: "passed",
      noiseFloorDb: -80,
      speechLufs: -27,
      truePeakDb: -10,
      thresholdDb: CALIBRATION.thresholdDb,
      recorderMic: CALIBRATION.recorderMic,
      browserInputLabel: CALIBRATION.browserInputLabel,
      scriptVersion: 3,
      micFilePath: "/calibrations/ok/mic.wav",
      browserTracePath: "/calibrations/ok/browser-trace.json",
      cameraDevice: "Cam Link 4K",
      clapsFound: 5,
      clapSpreadMs: 8,
      micOffsetMs: 142,
      cameraFilePath: "/calibrations/ok/camera.mkv",
    })
    .onConflictDoNothing();
  return CALIBRATION;
};

/** The latest calibration passed under today's rules, from PGlite, as the app reads it. */
export const calibrationFromDatabase: LastPassed = () =>
  Effect.runPromise(lastPassedCalibration(testDb as never));

/** The app server's recorder client, as live.server.ts makes it. */
export const connectClient = (
  port: number,
  ingest: Ingest = saveEvent,
  lastPassed: LastPassed = freshCalibration
) => {
  const client = createRecorderClient({
    url: `ws://127.0.0.1:${port}`,
    ingest,
    unfinishedRecordingSessions: (candidates) =>
      Effect.runPromise(
        unfinishedRecordingSessions(testDb as never, candidates)
      ),
    calibration: lastPassed,
    reconnectMs: 50,
    commandTimeoutMs: 5_000,
    closeGraceMs: 50,
    retryMs: 20,
    // A listener here never answers `speech-ended` unless its test does.
    placeTimeoutMs: 30,
    folder: STREAM_DECK_FOLDER,
  });
  clients.push(client);
  return client;
};

export type TestRecorderClient = ReturnType<typeof connectClient>;

export const readSession = () => testDb.query.recordingSessions.findFirst();

/** Records on a new CVM recorder Video, the insertion point at its start. */
export const recordOn = async (client: TestRecorderClient) => {
  const video = await clipService.createVideo("CVM recorder");
  client.subscribe(video.id, () => {});
  await vi.waitFor(() =>
    client.startRecording(video.id, {
      silenceLength: "short",
      folder: tmp(),
    })
  );
  return video;
};

/** The camera's speech detector hears speech over each [from, to]. */
export const speak = (
  camera: { stderr: (text: string) => void },
  ...takes: [number, number][]
) => {
  for (const [from, to] of takes) {
    camera.stderr(
      `[silencedetect @ 1] silence_end: ${from} | silence_duration: 1\r\n`
    );
    camera.stderr(`[silencedetect @ 1] silence_start: ${to}\r\n`);
  }
};

export const clipTimes = async (videoId: string) =>
  (await clipService.getTimeline(videoId)).flatMap((i) =>
    i.type === "clip" ? [[i.data.sourceStartTime, i.data.sourceEndTime]] : []
  );
