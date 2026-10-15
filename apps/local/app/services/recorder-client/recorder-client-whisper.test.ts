import { describe, expect, it, vi } from "vitest";
import { clipService, setupClipServiceTests } from "../clip-service-test-setup";
import {
  connectClient,
  saveEvent,
  startService,
} from "./recorder-client-test-harness";
import { WHISPER_WARM_MS } from "./whisper-warmth";

setupClipServiceTests();

describe("the recorder client and Whisper (#2214)", () => {
  it("holds Whisper warm from the moment the recorder opens, so no take cold-starts it", async () => {
    const { port } = await startService();
    const warmed: number[] = [];
    const client = connectClient(port, saveEvent, undefined, (ms) =>
      warmed.push(ms)
    );
    expect(warmed).toEqual([]);
    const video = await clipService.createVideo("CVM recorder");
    client.subscribe(video.id, () => {});
    await vi.waitFor(() => expect(warmed).toEqual([WHISPER_WARM_MS]));
  });
});
