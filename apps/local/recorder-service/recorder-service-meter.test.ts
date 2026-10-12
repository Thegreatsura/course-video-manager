import { describe, expect, it } from "vitest";
import { METER_WHILE_RECORDING, RECORD_WHILE_METERING } from "./protocol";
import { connect, start, tmp } from "./test-utils/service-harness";

/** The level meter through the WebSocket (test-utils/service-harness.ts). */

describe("the level meter", () => {
  it("streams ebur128's readings of the mic, and never runs alongside a recording", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");

    client.send({ type: "start-meter" });
    expect(await client.next("meter-started")).toMatchObject({
      mic: "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)",
    });
    const meter = windows.meter();
    expect(meter?.launch.args).toContain(
      "audio=Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)"
    );
    // ebur128's lines, as ffmpeg 8.0.1 prints them, among others that are not readings.
    meter?.stderr(
      "[aist#0:0/pcm_s16le @ 0000] [info] Starting thread...\r\n" +
        "[Parsed_ebur128_0 @ 000001d2] [info] t: 0.1   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU\r\n" +
        "[Parsed_ebur128_0 @ 000001d2] [info] t: 3.2   TARGET:-23 LUFS    M: -36.4 S: -38.1     I: -37.9 LUFS       LRA:   2.1 LU\r\n"
    );
    expect(await client.next("meter-reading")).toEqual({
      type: "meter-reading",
      seconds: 0.1,
      momentaryLufs: -120.7,
      shortTermLufs: -120.7,
    });
    expect(await client.next("meter-reading")).toEqual({
      type: "meter-reading",
      seconds: 3.2,
      momentaryLufs: -36.4,
      shortTermLufs: -38.1,
    });

    // Record is refused while the meter runs...
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    client.send({ type: "record", silenceLength: "short", folder: tmp() });
    expect((await client.next("refused")).message).toBe(RECORD_WHILE_METERING);

    // ...and once it stops, the mic is let go and Record records.
    client.send({ type: "stop-meter" });
    expect(await client.next("meter-stopped")).toMatchObject({ message: null });
    expect(windows.meter()).toBeUndefined();
    client.send({ type: "record", silenceLength: "short", folder: tmp() });
    await client.next("recording-started");

    // The meter is refused while recording.
    client.send({ type: "start-meter" });
    expect(await client.next("refused")).toMatchObject({
      command: "start-meter",
      message: METER_WHILE_RECORDING,
    });
    expect(windows.meter()).toBeUndefined();
  });
});
