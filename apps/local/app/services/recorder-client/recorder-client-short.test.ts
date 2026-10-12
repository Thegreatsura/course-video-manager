import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { fakeWindows } from "recorder-service/test-utils/fake-windows";
import { videos } from "@/db/schema";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import { requireRecordableVideo } from "./record-guard.server";
import {
  clipTimes,
  connectClient,
  readSession,
  speak,
  startService,
  tmp,
} from "./recorder-client-test-harness";

/**
 * A Short filmed with the CVM recorder, end to end without hardware
 * (recorder-client-test-harness.ts): the editor's subscription opens the
 * recorder in the Short's format, which wakes Spacedesk (a fake wake, never
 * the real one); Record, speech and Stop yield saved Clips whose Recording
 * Session remembers it was a Short.
 */

setupClipServiceTests();

const WAKE_ERROR = "connect ETIMEDOUT";

/** A Short that records with the CVM recorder. */
const createShort = async () => {
  const video = await clipService.createVideo("A Short");
  await testDb
    .update(videos)
    .set({ format: "short", recorder: "cvm" })
    .where(eq(videos.id, video.id));
  return video;
};

/** Open on a Short, as its editor's subscription opens it. */
const openShort = async (windows = fakeWindows()) => {
  const { port } = await startService(tmp(), windows);
  const client = connectClient(port);
  const video = await createShort();
  const heard: CvmRecorderMessage[] = [];
  client.subscribe(video.id, (m) => heard.push(m), "short");
  await vi.waitFor(() =>
    expect(heard).toContainEqual({ type: "camera-went-live" })
  );
  return { client, video, heard, windows };
};

const screens = (heard: CvmRecorderMessage[]) =>
  heard.flatMap((m) => (m.type === "screen-changed" ? [m.screen] : []));

/** Record as the record route does: the Video's format from the guard. */
const record = async (
  client: ReturnType<typeof connectClient>,
  videoId: string
) => {
  const { format } = await Effect.runPromise(
    requireRecordableVideo(testDb as never, videoId)
  );
  expect(format).toBe("short");
  await client.startRecording(videoId, {
    silenceLength: "short",
    insertionPoint: { type: "start" },
    folder: tmp(),
    format,
  });
};

describe("the recorder client on a Short", () => {
  it("opens the recorder for the Short, wakes Spacedesk, and saves a Camera take as a Short's Clips", async () => {
    const { client, video, heard, windows } = await openShort();
    await vi.waitFor(() =>
      expect(screens(heard).at(-1)).toEqual({ kind: "ready" })
    );
    expect(screens(heard)).toContainEqual({ kind: "waking" });
    expect(windows.wakes()).toBe(1);

    await client.switchScene(video.id, "Camera");
    await record(client, video.id);
    speak(windows.recorder("camera"), [2, 5]);
    await vi.waitFor(async () =>
      expect(await clipTimes(video.id)).toHaveLength(1)
    );
    await client.stopRecording(video.id);
    await vi.waitFor(() =>
      expect(heard.map((m) => m.type)).toContain("recording-stopped")
    );

    expect(await readSession()).toMatchObject({
      videoId: video.id,
      format: "short",
      screenCaptured: true,
      status: "stopped",
    });
    const [clip] = (await clipService.getTimeline(video.id)).flatMap((i) =>
      i.type === "clip" ? [i.data] : []
    );
    expect(clip?.scene).toBe("Camera");
  });

  it("with Spacedesk unavailable, refuses Code, records Camera only, and wakes it again on asking", async () => {
    const { client, video, heard, windows } = await openShort(
      fakeWindows({ wakeFails: WAKE_ERROR })
    );
    await vi.waitFor(() =>
      expect(screens(heard).at(-1)).toEqual({
        kind: "unavailable",
        message: `Could not wake Spacedesk: ${WAKE_ERROR}`,
      })
    );
    await expect(client.switchScene(video.id, "Code")).rejects.toThrow(
      /shows the screen, and this Short's screen is unavailable/
    );

    await client.switchScene(video.id, "Camera");
    await record(client, video.id);
    speak(windows.recorder("camera"), [2, 5]);
    await vi.waitFor(async () =>
      expect(await clipTimes(video.id)).toHaveLength(1)
    );
    await client.stopRecording(video.id);
    await vi.waitFor(async () =>
      expect(await readSession()).toMatchObject({
        format: "short",
        screenCaptured: false,
        status: "stopped",
      })
    );

    windows.spacedesk.wakeFails = undefined;
    await client.retryScreen(video.id);
    await vi.waitFor(() =>
      expect(screens(heard).at(-1)).toEqual({ kind: "ready" })
    );
    await client.switchScene(video.id, "Code");
  });
});
