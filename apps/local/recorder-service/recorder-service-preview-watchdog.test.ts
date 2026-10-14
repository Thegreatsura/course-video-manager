import { describe, expect, it, vi } from "vitest";
import { fakeWindows } from "./test-utils/fake-windows";
import { CALIBRATED, connect, start, tmp } from "./test-utils/service-harness";

/**
 * A preview that stalls while still running, or quits, is started again
 * (#2192): a Short's screen preview once froze at 75 s and stayed frozen
 * until `pnpm dev` restarted. The recording is never touched.
 */
describe("the preview watchdog", () => {
  it("starts a stalled or quit screen preview again, even mid-take, without touching the recording", async () => {
    const windows = fakeWindows();
    const { port } = await start(windows, tmp(), { previewStallMs: 150 });
    const client = await connect(port);
    await client.next("hello");
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    client.send({
      type: "record",
      silenceLength: "long",
      folder: tmp(),
      ...CALIBRATED,
    });
    await client.next("recording-started");
    await vi.waitFor(() => expect(windows.screenPreviews).toHaveLength(1));

    // Stalls: still running, sending nothing.
    const stalled = windows.screenPreviews[0]!;
    stalled.frozen = true;
    await vi.waitFor(() => expect(windows.screenPreviews).toHaveLength(2), {
      timeout: 3000,
    });
    expect(stalled.running).toBe(false);

    // Quits.
    windows.screenPreviews[1]!.exit(1);
    await vi.waitFor(() => expect(windows.screenPreviews).toHaveLength(3), {
      timeout: 3000,
    });

    expect(windows.recorder("screen").running).toBe(true);
    expect(windows.recorder("camera").running).toBe(true);
    expect(client.received.some((m) => m.type === "recording-stopped")).toBe(
      false
    );
  });

  it("opens the Cam Link again when its preview stalls while open", async () => {
    const windows = fakeWindows();
    const { port } = await start(windows, tmp(), { previewStallMs: 150 });
    const client = await connect(port);
    await client.next("hello");
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    windows.cameraPreviews[0]!.frozen = true;
    await vi.waitFor(() => expect(windows.cameraPreviews).toHaveLength(2), {
      timeout: 3000,
    });
    expect(windows.cameraPreviews[0]!.running).toBe(false);
    await client.camera("live");
  });
});
