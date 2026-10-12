import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { METER_WHILE_RECORDING, RECORD_WHILE_METERING } from "./protocol";
import { ebur128Line } from "./test-utils/fake-windows";
import { connect, start, tmp, THRESHOLD } from "./test-utils/service-harness";

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
    client.send({
      type: "record",
      silenceLength: "short",
      folder: tmp(),
      ...THRESHOLD,
    });
    expect((await client.next("refused")).message).toBe(RECORD_WHILE_METERING);

    // ...and once it stops, the mic is let go and Record records.
    client.send({ type: "stop-meter" });
    expect(await client.next("meter-stopped")).toMatchObject({ message: null });
    expect(windows.meter()).toBeUndefined();
    client.send({
      type: "record",
      silenceLength: "short",
      folder: tmp(),
      ...THRESHOLD,
    });
    await client.next("recording-started");

    // The meter is refused while recording.
    client.send({ type: "start-meter" });
    expect(await client.next("refused")).toMatchObject({
      command: "start-meter",
      message: METER_WHILE_RECORDING,
    });
    expect(windows.meter()).toBeUndefined();
  });

  it("runs an Audio Calibration: the mic to a file, timed readings, then the noise floor and speech loudness of its windows; a cancelled run keeps nothing", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    const folder = tmp();

    client.send({ type: "start-meter" });
    await client.next("meter-started");
    client.send({ type: "start-calibration", folder });
    const started = await client.next("calibration-started");
    expect(started.micFile).toMatch(
      new RegExp(`^${folder}/audio-calibrations/[^/]+/mic\\.wav$`)
    );
    expect(fs.existsSync(path.dirname(started.micFile))).toBe(true);
    // One process holds the mic: the run's, writing the file.
    const run = windows.meter();
    expect(run?.launch.args).toContain("mic.wav");
    run?.stderr(`${ebur128Line(12.3, -21.9, -22.4)}\r\n`);
    expect(await client.next("meter-reading")).toMatchObject({
      seconds: 12.3,
      shortTermLufs: -22.4,
    });

    // Record is refused while it runs.
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    client.send({
      type: "record",
      silenceLength: "short",
      folder: tmp(),
      ...THRESHOLD,
    });
    expect((await client.next("refused")).message).toBe(RECORD_WHILE_METERING);

    client.send({
      type: "finish-calibration",
      silence: { startSeconds: 3.75, endSeconds: 12.25 },
      speech: [
        { startSeconds: 13.75, endSeconds: 19.75 },
        { startSeconds: 23.75, endSeconds: 29.75 },
      ],
    });
    expect(await client.next("calibration-measured")).toEqual({
      type: "calibration-measured",
      calibrationId: started.calibrationId,
      mic: "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)",
      micFile: started.micFile,
      noiseFloorDb: -97.3,
      speechLufs: -21.4,
    });
    const analysis = windows.launched.find((l) =>
      l.args.some((a) => a.includes("astats="))
    );
    expect(analysis?.args.join(" ")).toContain(
      "atrim=start=3.75:end=12.25,astats="
    );
    expect(analysis?.args.join(" ")).toContain("concat=n=2:v=0:a=1,ebur128");
    // The run is over and the plain meter is back, not writing a file.
    expect(run?.running).toBe(false);
    expect(windows.meter()?.launch.args).not.toContain("mic.wav");

    // A cancelled run deletes its folder.
    client.send({ type: "start-calibration", folder });
    const cancelled = await client.next("calibration-started");
    client.send({ type: "cancel-calibration" });
    expect(await client.next("calibration-ended")).toEqual({
      type: "calibration-ended",
      calibrationId: cancelled.calibrationId,
      message: null,
    });
    expect(fs.existsSync(path.dirname(cancelled.micFile))).toBe(false);
    expect(fs.existsSync(path.dirname(started.micFile))).toBe(true);
  });
});
