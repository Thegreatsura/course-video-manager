import net from "node:net";
import type { Launch, LaunchedProcess, Launcher } from "../launcher";

/**
 * A scripted Windows for the recorder service's tests: the process launcher,
 * the one seam they fake. Its ffmpeg.exe answers -version and -list_devices,
 * and its recorders print what a test tells them to and quit on `q`. Its
 * camera preview processes behave as the test scripts each try at the Cam
 * Link (`CameraTry`); one that gets frames sends a few tiny JPEGs a second to
 * the service's preview feed, as ffmpeg's mpjpeg would.
 * Nothing here opens a real device.
 */

/**
 * One try at opening the Cam Link: frames arrive, nothing arrives (the
 * Cam Link's start-up trouble), or another program holds it.
 */
export type CameraTry = "frames" | "silent" | "busy";

export type FakeProcess = LaunchedProcess & {
  launch: Launch;
  stdout(text: string): void;
  stderr(text: string): void;
  exit(code: number | null): void;
  /** False once it has exited. */
  readonly running: boolean;
  /** What it prints between `q` and exiting. */
  onQuit?: () => void;
};

const fakeProcess = (launch: Launch): FakeProcess => {
  const out: ((c: string) => void)[] = [];
  const err: ((c: string) => void)[] = [];
  let resolveExit!: (code: number | null) => void;
  let running = true;
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
    exit: (code) => {
      running = false;
      resolveExit(code);
    },
    get running() {
      return running;
    },
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

const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

/** Sends a "JPEG" to the preview feed in the args every 20 ms until exit. */
const sendFrames = (
  p: FakeProcess,
  args: readonly string[],
  jpeg: Buffer = TINY_JPEG
) => {
  const port = Number(args.join(" ").match(/tcp:\/\/127\.0\.0\.1:(\d+)/)?.[1]);
  const socket = net.connect(port, "127.0.0.1");
  socket.on("error", () => {});
  const timer = setInterval(() => {
    socket.write(
      `--ffmpeg\r\nContent-Type: image/jpeg\r\nContent-length: ${jpeg.length}\r\n\r\n`
    );
    socket.write(jpeg);
    socket.write("\r\n");
  }, 20);
  void p.exited.then(() => {
    clearInterval(timer);
    socket.destroy();
  });
};

const isPreview = (l: Launch, input: string) =>
  l.tool === "ffmpeg" &&
  l.args.some((a) => a.includes("tcp://")) &&
  !l.args.some((a) => a.endsWith(".mkv")) &&
  l.args.some((a) => a.includes(input));

export const fakeWindows = (
  o: {
    ffmpegVersion?: string;
    driver?: string;
    /** Each try at the Cam Link in turn; every try after these gets frames. */
    cameraTries?: CameraTry[];
    /** A real JPEG per preview, for a browser to show (verify-cvm). */
    jpeg?: { camera: Buffer; screen: Buffer };
  } = {}
) => {
  const recorders: FakeProcess[] = [];
  const cameraPreviews: FakeProcess[] = [];
  const screenPreviews: FakeProcess[] = [];
  const cameraTries = [...(o.cameraTries ?? [])];
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
    if (isPreview(l, "video=")) {
      cameraPreviews.push(p);
      const next = cameraTries.shift() ?? "frames";
      if (next === "frames") sendFrames(p, l.args, o.jpeg?.camera);
      if (next === "busy") {
        // What dshow says when OBS has the Cam Link.
        return answer(p, {
          stderr:
            "[dshow @ 0001] [error] Could not run graph (sometimes caused by a device already in use by other application)\r\n",
          code: 1,
        });
      }
      return p;
    }
    if (isPreview(l, "ddagrab")) {
      screenPreviews.push(p);
      sendFrames(p, l.args, o.jpeg?.screen);
      return p;
    }
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
  /** How many camera processes (preview or recording) hold the Cam Link now. */
  const camerasRunning = () =>
    [...cameraPreviews, ...recorders].filter(
      (p) =>
        p.running &&
        p.launch.tool === "ffmpeg" &&
        p.launch.args.some((a) => a.startsWith("video="))
    ).length;
  return {
    launch,
    recorders,
    recorder,
    cameraPreviews,
    screenPreviews,
    camerasRunning,
  };
};
