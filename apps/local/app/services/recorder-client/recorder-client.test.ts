import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { startRecorderService } from "recorder-service/recorder-service";
import {
  fakeFootage,
  fakeWindows,
} from "recorder-service/test-utils/fake-windows";
import { WebSocket } from "ws";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { NewRecorderMessage } from "@/features/video-editor/new-recorder-wire";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import { createRecorderClient } from "./client.server";
import {
  ingestRecorderEvent,
  unfinishedRecordingSessions,
} from "./ingest.server";

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

const startService = async (stateDir = tmp()) => {
  const windows = fakeWindows();
  const service = await startRecorderService({
    port: 0,
    launch: windows.launch,
    now: () => 1_760_000_000_000,
    stateDir,
  });
  cleanups.unshift(() => service.close());
  return { windows, port: service.port, stateDir };
};

/** The app server's recorder client, as live.server.ts makes it. */
const connectClient = (port: number) => {
  const client = createRecorderClient({
    url: `ws://127.0.0.1:${port}`,
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
    unfinishedRecordingSessions: () =>
      Effect.runPromise(unfinishedRecordingSessions(testDb as never)),
    reconnectMs: 50,
    commandTimeoutMs: 5_000,
  });
  cleanups.unshift(() => client.close());
  return client;
};

const setup = async () => {
  const { windows, port, stateDir } = await startService();
  return { windows, client: connectClient(port), port, stateDir };
};

const readSession = () => testDb.query.recordingSessions.findFirst();

const recordOn = async (client: ReturnType<typeof connectClient>) => {
  const video = await clipService.createVideo("new recorder");
  client.subscribe(video.id, () => {});
  await vi.waitFor(() =>
    client.startRecording(video.id, {
      silenceLength: "short",
      insertionPoint: { type: "start" },
      folder: tmp(),
    })
  );
  return video;
};

const clipTimes = async (videoId: string) =>
  (await clipService.getTimeline(videoId)).flatMap((i) =>
    i.type === "clip" ? [[i.data.sourceStartTime, i.data.sourceEndTime]] : []
  );

describe("the recorder client", () => {
  it("records on a New recorder Video: Record, speech, Stop yields saved Clips, live", async () => {
    const { windows, client } = await setup();
    const video = await clipService.createVideo("new recorder");
    const heard: NewRecorderMessage[] = [];
    client.subscribe(video.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual(
        expect.objectContaining({ type: "recorder-status", reachable: true })
      )
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
      unfinishedRecordingSessions: () => Promise.resolve([]),
      reconnectMs: 1_000,
      commandTimeoutMs: 1_000,
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

  it("marks a Recording Session crashed when the recorder service comes back after dying mid-take, keeping every take", async () => {
    const { windows, client, stateDir } = await setup();
    const video = await recordOn(client);
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 1] silence_start: -0.0001\r\n");
    camera.stderr(
      "[silencedetect @ 1] silence_end: 2 | silence_duration: 2\r\n"
    );
    camera.stderr("[silencedetect @ 1] silence_start: 5\r\n");
    camera.stderr(
      "[silencedetect @ 1] silence_end: 7 | silence_duration: 2\r\n"
    );
    await vi.waitFor(async () =>
      expect(await clipTimes(video.id)).toHaveLength(1)
    );

    // The service dies mid-take, leaving its files unfinished; the app
    // server goes with it.
    const session = await readSession();
    fs.writeFileSync(
      session!.cameraFilePath,
      fakeFootage(12, { unfinished: true })
    );
    fs.writeFileSync(
      session!.screenFilePath,
      fakeFootage(12, { unfinished: true })
    );
    fs.writeFileSync(
      session!.micFilePath,
      fakeFootage(12, { unfinished: true })
    );
    client.close();

    const restarted = await startService(stateDir);
    connectClient(restarted.port);

    await vi.waitFor(async () =>
      expect((await readSession())?.status).toBe("crashed")
    );
    expect(await clipTimes(video.id)).toEqual([
      [2.15, 5.23],
      [7.15, 12.23],
    ]);
  });

  it("catches up on a stop it missed while the app server was down", async () => {
    const { client, port } = await setup();
    await recordOn(client);
    client.close();

    // Stopped from elsewhere (the Stream Deck) while no app server listened.
    const deck = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => deck.once("open", r));
    deck.send(JSON.stringify({ type: "stop" }));
    cleanups.unshift(() => deck.close());
    await vi.waitFor(async () => {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect((await health.json()).state.kind).toBe("open");
    });

    connectClient(port);
    await vi.waitFor(async () =>
      expect((await readSession())?.status).toBe("stopped")
    );
  });
});
