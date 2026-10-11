import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { CAM_LINK_FRAME_INTERVAL, dshowFrameInterval } from "./capture-args";
import type { Launch, LaunchedProcess, Launcher } from "./launcher";
import type { RecorderCommand, RecorderMessage } from "./protocol";
import { startRecorderService } from "./recorder-service";

/**
 * The recorder service driven through its WebSocket, with the process
 * launcher as the only fake: a scripted Windows whose ffmpeg.exe answers
 * -version and -list_devices, and whose recorders print what the test tells
 * them to and quit on `q`. Nothing here opens a real device.
 */

const T0_MS = 1_760_000_000_000;

type FakeProcess = LaunchedProcess & {
  launch: Launch;
  stdout(text: string): void;
  stderr(text: string): void;
  exit(code: number | null): void;
  /** What it prints between `q` and exiting. */
  onQuit?: () => void;
};

const fakeProcess = (launch: Launch): FakeProcess => {
  const out: ((c: string) => void)[] = [];
  const err: ((c: string) => void)[] = [];
  let resolveExit!: (code: number | null) => void;
  const exited = new Promise<number | null>((r) => (resolveExit = r));
  const p: FakeProcess = {
    launch,
    onStdout: (l) => void out.push(l),
    onStderr: (l) => void err.push(l),
    writeStdin: (text) => {
      // ffmpeg closes its files and exits 0 on `q`.
      if (text === "q") {
        setImmediate(() => {
          p.onQuit?.();
          p.exit(0);
        });
      }
    },
    exited,
    kill: () => p.exit(null),
    stdout: (t) => out.forEach((l) => l(t)),
    stderr: (t) => err.forEach((l) => l(t)),
    exit: (code) => resolveExit(code),
  };
  return p;
};

/** Answers a short-lived process on the next tick, then exits it. */
const answer = (
  p: FakeProcess,
  o: { stdout?: string; stderr?: string; code?: number }
) => {
  setImmediate(() => {
    if (o.stdout) p.stdout(o.stdout);
    if (o.stderr) p.stderr(o.stderr);
    p.exit(o.code ?? 0);
  });
  return p;
};

const DEVICE_LISTING = [
  '[in#0 @ 000001] "Cam Link 4K" (video)',
  '[in#0 @ 000001]   Alternative name "@device_pnp_\\\\?\\usb#vid_0fd9"',
  '[in#0 @ 000001] "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)" (audio)',
  "Error opening input file dummy.",
].join("\r\n");

const fakeWindows = (o: { ffmpegVersion?: string; driver?: string } = {}) => {
  const recorders: FakeProcess[] = [];
  const launch: Launcher = (l) => {
    const p = fakeProcess(l);
    if (l.tool === "nvidia-smi")
      return answer(p, { stdout: `${o.driver ?? "591.74"}\r\n` });
    if (l.tool === "powershell" && l.script === "screens.ps1") {
      return answer(p, {
        stdout:
          "0\t0\t0\t2560\t1440\t\\\\.\\DISPLAY1\tLG HDR QHD\r\n1\t2560\t0\t1920\t1080\t\\\\.\\DISPLAY2\tDELL U2424H\r\n",
      });
    }
    if (l.tool === "powershell")
      return answer(p, {
        stdout: "timeBeginPeriod(1) in ffmpeg.exe 42, priority High\r\n",
      });
    if (l.args.includes("-version")) {
      return answer(p, {
        stdout: `ffmpeg version ${o.ffmpegVersion ?? "8.0.1-full_build-www.gyan.dev"} Copyright (c) 2000-2025\r\n`,
      });
    }
    // 8.0.1 exits 0 after listing, on stderr.
    if (l.args.includes("-list_devices"))
      return answer(p, { stderr: DEVICE_LISTING, code: 0 });
    recorders.push(p);
    return p;
  };
  const recorder = (kind: "screen" | "camera") => {
    const p = recorders.find(
      (r) => r.launch.tool === "ffmpeg" && r.launch.args.includes(`${kind}.mkv`)
    );
    if (!p) throw new Error(`no ${kind} recorder was launched`);
    return p;
  };
  return { launch, recorders, recorder };
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recorder-service-"));
  cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const start = async (windows = fakeWindows(), stateDir = tmp()) => {
  const service = await startRecorderService({
    port: 0,
    launch: windows.launch,
    now: () => T0_MS,
    stateDir,
  });
  cleanups.unshift(() => service.close());
  return { windows, stateDir, port: service.port, close: service.close };
};

const connect = async (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const received: RecorderMessage[] = [];
  const waiters: {
    match: (m: RecorderMessage) => boolean;
    resolve: (m: RecorderMessage) => void;
  }[] = [];
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString()) as RecorderMessage;
    received.push(message);
    for (const w of waiters.slice()) {
      if (w.match(message)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(message);
      }
    }
  });
  await new Promise((r) => ws.once("open", r));
  cleanups.unshift(async () => ws.close());
  const next = <T extends RecorderMessage["type"]>(type: T) => {
    const seen = received.find((m) => m.type === type);
    if (seen) {
      received.splice(received.indexOf(seen), 1);
      return Promise.resolve(seen as Extract<RecorderMessage, { type: T }>);
    }
    return new Promise<Extract<RecorderMessage, { type: T }>>((resolve) =>
      waiters.push({
        match: (m) =>
          m.type === type && (received.splice(received.indexOf(m), 1), true),
        resolve: (m) => resolve(m as Extract<RecorderMessage, { type: T }>),
      })
    );
  };
  return {
    send: (command: RecorderCommand) => ws.send(JSON.stringify(command)),
    next,
    received,
  };
};

const readLog = (file: string) =>
  fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { seq: number; type: string });

describe("start-up checks", () => {
  it("refuses any ffmpeg other than 8.0.1, saying how to install it", async () => {
    const { port } = await start(
      fakeWindows({ ffmpegVersion: "8.1-full_build-www.gyan.dev" })
    );
    const client = await connect(port);
    const hello = await client.next("hello");
    expect(hello.ffmpeg.ok).toBe(false);
    const message = hello.ffmpeg.ok ? "" : hello.ffmpeg.message;
    expect(message).toContain("8.1");
    expect(message).toContain("winget install Gyan.FFmpeg --version 8.0.1");

    client.send({ type: "open", videoId: "v1" });
    expect((await client.next("refused")).message).toBe(message);
  });

  it("only warns when the NVIDIA driver changed since the last start", async () => {
    const stateDir = tmp();
    const first = await start(fakeWindows({ driver: "591.74" }), stateDir);
    expect((await (await connect(first.port)).next("hello")).warnings).toEqual(
      []
    );
    await first.close();

    const second = await start(fakeWindows({ driver: "610.12" }), stateDir);
    const hello = await (await connect(second.port)).next("hello");
    expect(hello.ffmpeg.ok).toBe(true);
    expect(hello.warnings).toHaveLength(1);
    expect(hello.warnings[0]).toContain("591.74 to 610.12");
  });
});

const recordOnce = async () => {
  const s = await start();
  const folder = tmp();
  const client = await connect(s.port);
  await client.next("hello");
  client.send({ type: "open", videoId: "video-1" });
  client.send({ type: "record", silenceLength: "long", folder });
  const started = await client.next("recording-started");
  return { ...s, client, started, folder };
};

describe("a Recording Session", () => {
  it("is refused before the recorder is open for a Video", async () => {
    const { port } = await start();
    const client = await connect(port);
    client.send({ type: "record", silenceLength: "short", folder: tmp() });
    expect((await client.next("refused")).command).toBe("record");
  });

  it("records camera, screen and mic to three files and stops on request", async () => {
    const { windows, client, started, folder } = await recordOnce();
    // A file that closes in silence gets one last silence_end: not speech.
    const camera = windows.recorder("camera");
    camera.onQuit = () =>
      camera.stderr(
        "[silencedetect @ 1] silence_end: 20.0 | silence_duration: 20\r\n"
      );
    expect(started.videoId).toBe("video-1");
    expect(started.t0Ms).toBe(T0_MS);
    const files = Object.values(started.files);
    expect(new Set(files).size).toBe(3);
    for (const f of files)
      expect(path.dirname(f).startsWith(folder)).toBe(true);

    client.send({ type: "stop" });
    const stopped = await client.next("recording-stopped");
    expect(stopped.reason).toBe("requested");
    expect(stopped.files).toEqual(started.files);
    expect(stopped.exitCodes).toEqual({ screen: 0, camera: 0 });
    expect(client.received.filter((m) => m.type.startsWith("speech"))).toEqual(
      []
    );
  });

  it("captures as the rig proved: separate processes, one T0, the Cam Link at 29.97 to 1440p", async () => {
    const { windows } = await recordOnce();
    const screen = windows.recorder("screen").launch;
    const camera = windows.recorder("camera").launch;
    if (screen.tool !== "ffmpeg" || camera.tool !== "ffmpeg")
      throw new Error("not ffmpeg");
    const s = screen.args.join(" ");
    const c = camera.args.join(" ");

    expect(s).toContain("ddagrab=output_idx=1");
    expect(s).not.toContain("dshow");
    expect(c).not.toContain("ddagrab");

    const at = (args: readonly string[], flag: string) =>
      args[args.indexOf(flag) + 1];
    expect(at(camera.args, "-video_size")).toBe("3840x2160");
    expect(dshowFrameInterval(at(camera.args, "-framerate") ?? "")).toBe(
      CAM_LINK_FRAME_INTERVAL
    );
    expect(c).toContain("scale_cuda=2560:1440");

    const t0 = `PTS-${(T0_MS / 1000).toFixed(3)}/TB`;
    expect(s).toContain(`setpts=${t0}`);
    expect(c).toContain(`setpts=${t0}`);
    expect(c).toContain(`asetpts=${t0}`);
    expect(c).toContain("silencedetect=n=-38dB:d=2");
  });

  it("turns silencedetect lines into speech events in file time, numbered in order", async () => {
    const { windows, client, started } = await recordOnce();
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 000001] [info] silence_start: -0.0001\r\n");
    camera.stderr(
      "[silencedetect @ 000001] [info] silence_end: 3.52 | silence_duration: 3.52\r\n"
    );
    camera.stderr("[silencedetect @ 000001] [info] silence_start: 9.");
    camera.stderr(
      "1\r\n[silencedetect @ 000001] [info] silence_end: 12.0 | silence_duration: 2.9\r\n"
    );
    camera.stdout("out_time_us=15000000\nprogress=continue\n");

    expect(await client.next("speech-started")).toMatchObject({
      fileTime: 3.52,
    });
    expect(await client.next("speech-ended")).toMatchObject({ fileTime: 9.1 });
    expect(await client.next("speech-started")).toMatchObject({ fileTime: 12 });

    client.send({ type: "stop" });
    // Speech still going at stop ends where the file does.
    expect(await client.next("speech-ended")).toMatchObject({ fileTime: 15 });
    await client.next("recording-stopped");

    const logged = readLog(
      path.join(path.dirname(started.files.mic), "events.jsonl")
    );
    expect(logged.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        "recording-started",
        "speech-started",
        "speech-ended",
        "recording-stopped",
      ])
    );
    expect(logged.map((e) => e.seq)).toEqual(logged.map((_, i) => i + 1));
  });

  it("stops when a recorder quits on its own, stopping the other", async () => {
    const { windows, client } = await recordOnce();
    windows
      .recorder("screen")
      .stderr("[ddagrab @ 0001] [error] Failed to capture frame\r\n");
    windows.recorder("screen").exit(1);
    const stopped = await client.next("recording-stopped");
    expect(stopped.reason).toBe("ffmpeg-exited");
    expect(stopped.exitCodes).toEqual({ screen: 1, camera: 0 });
    expect(stopped.errors.join("\n")).toContain("Failed to capture frame");
  });

  it("replays the logged events after a given sequence number to a client that missed them", async () => {
    const { windows, client, started, port } = await recordOnce();
    windows
      .recorder("camera")
      .stderr("[silencedetect @ 1] silence_end: 2.0 | silence_duration: 2\r\n");
    await client.next("speech-started");
    client.send({ type: "stop" });
    const stopped = await client.next("recording-stopped");

    const late = await connect(port);
    late.send({
      type: "replay",
      recordingSessionId: started.recordingSessionId,
      afterSeq: 1,
    });
    const done = await late.next("replay-done");
    expect(done.lastSeq).toBe(stopped.seq);
    const replayed = late.received.filter((m) => "seq" in m);
    expect(replayed.map((m) => ("seq" in m ? m.seq : 0))).toEqual(
      Array.from({ length: stopped.seq - 1 }, (_, i) => i + 2)
    );
    expect(replayed.at(-1)).toEqual(stopped);
  });
});
