import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { startRecorderService } from "recorder-service/recorder-service";
import { fakeWindows } from "recorder-service/test-utils/fake-windows";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { NewRecorderMessage } from "@/features/video-editor/new-recorder-wire";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import { createRecorderClient } from "./client.server";
import { ingestRecorderEvent } from "./ingest.server";

/**
 * End to end, without hardware: the real recorder service on a scripted
 * Windows (its fake ffmpeg.exe), the app server's recorder client, and the
 * database on PGlite. Record, speak, Stop: saved Clips.
 */

setupClipServiceTests();

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recorder-client-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const setup = async () => {
  const windows = fakeWindows();
  const service = await startRecorderService({
    port: 0,
    launch: windows.launch,
    now: () => 1_760_000_000_000,
    stateDir: tmp(),
  });
  cleanups.unshift(() => service.close());
  const client = createRecorderClient({
    url: `ws://127.0.0.1:${service.port}`,
    ingest: (event, insertionPointFor) =>
      Effect.runPromise(
        ingestRecorderEvent(testDb as never, event, insertionPointFor).pipe(
          Effect.provide(
            JobOperationsService.Default.pipe(
              Layer.provide(Layer.succeed(DrizzleService, testDb as never))
            )
          )
        )
      ),
    reconnectMs: 50,
    commandTimeoutMs: 5_000,
    closeGraceMs: 50,
  });
  cleanups.unshift(() => client.close());
  return { windows, client };
};

describe("the recorder client", () => {
  it("records on a New recorder Video: Record, speech, Stop yields saved Clips, live", async () => {
    const { windows, client } = await setup();
    const video = await clipService.createVideo("new recorder");
    const heard: NewRecorderMessage[] = [];
    client.subscribe(video.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );

    await client.startRecording(video.id, {
      silenceLength: "short",
      insertionPoint: { type: "start" },
      folder: tmp(),
    });
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 1] silence_start: -0.0001\r\n");
    camera.stderr(
      "[silencedetect @ 1] silence_end: 2 | silence_duration: 2\r\n"
    );
    camera.stderr("[silencedetect @ 1] silence_start: 5\r\n");
    camera.stderr(
      "[silencedetect @ 1] silence_end: 7 | silence_duration: 2\r\n"
    );
    camera.stderr("[silencedetect @ 1] silence_start: 10\r\n");

    // Clips arrive while still recording, already saved.
    await vi.waitFor(async () =>
      expect(
        (await clipService.getTimeline(video.id)).filter(
          (i) => i.type === "clip"
        )
      ).toHaveLength(2)
    );

    await client.stopRecording(video.id);
    await vi.waitFor(() =>
      expect(heard.map((m) => m.type)).toContain("recording-stopped")
    );

    const clips = (await clipService.getTimeline(video.id)).flatMap((i) =>
      i.type === "clip" ? [i.data] : []
    );
    expect(
      clips.map((c) => [c.sourceStartTime, c.sourceEndTime, c.videoFilename])
    ).toEqual([
      [2.15, 5.23, expect.stringMatching(/mic\.mkv$/)],
      [7.15, 10.23, expect.stringMatching(/mic\.mkv$/)],
    ]);
    const saved = heard.filter((m) => m.type === "clips-saved");
    expect(saved.flatMap((m) => m.clips.map((c) => c.id))).toEqual(
      clips.map((c) => c.id)
    );
    const session = await testDb.query.recordingSessions.findFirst();
    expect(session).toMatchObject({ videoId: video.id, status: "stopped" });
  });

  it("opens the recorder, and the Cam Link, only while an editor listens on the Video", async () => {
    const { windows, client } = await setup();
    expect(windows.camerasRunning()).toBe(0);

    const heard: NewRecorderMessage[] = [];
    const unsubscribe = client.subscribe("video-1", (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    expect(windows.camerasRunning()).toBe(1);
    expect(heard).toContainEqual(
      expect.objectContaining({
        type: "recorder-status",
        previews: {
          camera: expect.stringMatching(
            /^http:\/\/127\.0\.0\.1:\d+\/preview\/camera$/
          ),
          screen: expect.stringMatching(/\/preview\/screen$/),
        },
      })
    );

    unsubscribe();
    await vi.waitFor(() => expect(windows.camerasRunning()).toBe(0));
  });

  it("refuses Record with the recorder's reason", async () => {
    const { client } = await setup();
    const video = await clipService.createVideo("new recorder");
    client.subscribe(video.id, () => {});
    await vi.waitFor(() =>
      expect(
        client.startRecording(video.id, {
          silenceLength: "short",
          insertionPoint: { type: "start" },
          folder: "relative/folder",
        })
      ).rejects.toThrow("The folder must be an absolute path")
    );
  });

  it("says so when the recorder service is not running", async () => {
    const client = createRecorderClient({
      url: "ws://127.0.0.1:9",
      ingest: () => Promise.reject(new Error("unused")),
      reconnectMs: 1_000,
      commandTimeoutMs: 1_000,
      closeGraceMs: 0,
    });
    cleanups.push(() => client.close());

    await expect(
      client.startRecording("v1", {
        silenceLength: "short",
        insertionPoint: { type: "start" },
        folder: "/tmp",
      })
    ).rejects.toThrow("The recorder service is not running");
  });
});
