import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CAM_LINK_NOT_STARTING } from "./camera";
import { METER_WHILE_RECORDING, RECORD_WHILE_METERING } from "./protocol";
import { CLOSE_OBS_TO_CALIBRATE } from "../app/av-calibration-constants";
import { ebur128Line } from "./test-utils/fake-windows";
import { connect, start, tmp, CALIBRATED } from "./test-utils/service-harness";

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
      ...CALIBRATED,
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
      ...CALIBRATED,
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

  it("runs an AV Calibration: the mic and camera to files on one clock, started once live, then the noise floor and speech loudness of its windows and the true peak of all but the claps; a cancelled run keeps nothing", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    const folder = tmp();

    // The recorder is open for a Video: its preview has the Cam Link.
    client.send({ type: "open", videoId: "video-1" });
    await client.camera("live");
    expect(windows.camerasRunning()).toBe(1);

    client.send({ type: "start-meter" });
    await client.next("meter-started");
    client.send({ type: "start-calibration", folder });
    // One process holds the mic and the camera: the run's, writing both. The
    // preview let the Cam Link go for it.
    await vi.waitFor(() =>
      expect(windows.meter()?.launch.args).toContain("mic.wav")
    );
    const run = windows.meter()!;
    expect(run.launch.args).toContain("camera.mkv");
    expect(run.launch.args).toContain("video=Cam Link 4K");
    const graph = run.launch.args.join(" ");
    // The recording's own stamping, so the Mic Offset is the recording's.
    expect(graph).toMatch(
      /\[0:v\]setpts=PTS-[\d.]+\/TB,fps=30000\/1001:start_time=0/
    );
    expect(graph).toMatch(
      /\[1:a\]asetpts=PTS-[\d.]+\/TB,atrim=start=1\.5,aresample=async=50:min_hard_comp=0\.1:first_pts=0,ebur128/
    );
    expect(windows.cameraPreviews.filter((p) => p.running)).toHaveLength(0);

    // It is started once live: its first reading, after the camera opened.
    run.stderr(`${ebur128Line(4.6, -60, -60)}\r\n`);
    const started = await client.next("calibration-started");
    expect(started.micFile).toMatch(
      new RegExp(`^${folder}/av-calibrations/[^/]+/mic\\.wav$`)
    );
    expect(started.cameraFile).toBe(
      path.join(path.dirname(started.micFile), "camera.mkv")
    );
    expect(started.camera).toBe("Cam Link 4K");
    expect(started.scriptStartSeconds).toBeGreaterThanOrEqual(4.6);
    expect(fs.existsSync(path.dirname(started.micFile))).toBe(true);
    expect(await client.next("meter-reading")).toMatchObject({ seconds: 4.6 });

    // Record is refused while it runs.
    client.send({
      type: "record",
      silenceLength: "short",
      folder: tmp(),
      ...CALIBRATED,
    });
    expect((await client.next("refused")).message).toBe(RECORD_WHILE_METERING);

    client.send({
      type: "finish-calibration",
      silence: { startSeconds: 3.75, endSeconds: 12.25 },
      speech: [
        { startSeconds: 13.75, endSeconds: 19.75 },
        { startSeconds: 23.75, endSeconds: 29.75 },
      ],
      claps: { startSeconds: 20, endSeconds: 23 },
    });
    expect(await client.next("calibration-measured")).toEqual({
      type: "calibration-measured",
      calibrationId: started.calibrationId,
      mic: "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)",
      micFile: started.micFile,
      camera: "Cam Link 4K",
      cameraFile: started.cameraFile,
      noiseFloorDb: -97.3,
      speechLufs: -27.4,
      truePeakDb: -9.2,
    });
    const analysis = windows.launched.find((l) =>
      l.args.some((a) => a.includes("astats="))
    );
    const analysed = analysis?.args.join(" ");
    expect(analysed).toContain("atrim=start=3.75:end=12.25,astats=");
    expect(analysed).toContain("concat=n=2:v=0:a=1,ebur128");
    // The true peak is over the take with the clap window cut out.
    expect(analysed).toContain("[pa]atrim=end=20,");
    expect(analysed).toContain("[pb]atrim=start=23,");
    expect(analysed).toContain(
      "[p0][p1]concat=n=2:v=0:a=1,ebur128=peak=true:framelog=quiet,anullsink"
    );
    // Both processes' ffmpeg logs are kept beside the files.
    const runDir = path.dirname(started.micFile);
    expect(
      fs.readFileSync(path.join(runDir, "ffmpeg-capture.log"), "utf8")
    ).toContain(ebur128Line(4.6, -60, -60));
    expect(
      fs.readFileSync(path.join(runDir, "ffmpeg-analysis.log"), "utf8")
    ).toContain("RMS level dB");
    // The run is over, the plain meter is back, and so is the preview.
    expect(run.running).toBe(false);
    expect(windows.meter()?.launch.args).not.toContain("mic.wav");
    await vi.waitFor(() =>
      expect(windows.cameraPreviews.filter((p) => p.running)).toHaveLength(1)
    );

    // A cancelled run deletes its folder.
    client.send({ type: "start-calibration", folder });
    await vi.waitFor(() =>
      expect(windows.meter()?.launch.args).toContain("mic.wav")
    );
    windows.meter()!.stderr(`${ebur128Line(3.1, -60, -60)}\r\n`);
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

  it("refuses to start a run whose camera never goes live, and keeps nothing", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    const folder = tmp();
    client.send({ type: "start-meter" });
    await client.next("meter-started");
    client.send({ type: "start-calibration", folder });
    expect(await client.next("refused")).toMatchObject({
      command: "start-calibration",
      message: CAM_LINK_NOT_STARTING,
    });
    expect(fs.readdirSync(path.join(folder, "av-calibrations"))).toEqual([]);
    // The plain meter is back.
    expect(windows.meter()?.launch.args).not.toContain("mic.wav");
  });

  it("refuses to start a run while another program holds the Cam Link, says Close OBS to calibrate, keeps nothing, and starts once it is freed", async () => {
    const { port, windows } = await start();
    const client = await connect(port);
    await client.next("hello");
    const folder = tmp();
    client.send({ type: "start-meter" });
    await client.next("meter-started");

    client.send({ type: "start-calibration", folder });
    await vi.waitFor(() =>
      expect(windows.meter()?.launch.args).toContain("mic.wav")
    );
    // What dshow says when OBS has the Cam Link: a synthetic error, no device.
    const busy = windows.meter()!;
    busy.stderr(
      "[dshow @ 0001] [error] Could not run graph (sometimes caused by a device already in use by other application)\r\n" +
        "[in#1 @ 0002] [error] Error opening input: I/O error\r\n"
    );
    busy.exit(1);
    expect(await client.next("refused")).toMatchObject({
      command: "start-calibration",
      message: CLOSE_OBS_TO_CALIBRATE,
    });
    expect(fs.readdirSync(path.join(folder, "av-calibrations"))).toEqual([]);
    expect(windows.meter()?.launch.args).not.toContain("mic.wav");

    // OBS lets go: Start runs.
    client.send({ type: "start-calibration", folder });
    await vi.waitFor(() =>
      expect(windows.meter()?.launch.args).toContain("mic.wav")
    );
    windows.meter()!.stderr(`${ebur128Line(3.4, -60, -60)}\r\n`);
    expect(await client.next("calibration-started")).toMatchObject({
      camera: "Cam Link 4K",
    });
  });
});
