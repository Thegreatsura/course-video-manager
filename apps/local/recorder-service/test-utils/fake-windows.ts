import type { Launch, LaunchedProcess, Launcher } from "../launcher";

/**
 * A scripted Windows for the recorder service's tests: the process launcher,
 * the one seam they fake. Its ffmpeg.exe answers -version and -list_devices,
 * and its recorders print what a test tells them to and quit on `q`.
 * Nothing here opens a real device.
 */

export type FakeProcess = LaunchedProcess & {
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

export const fakeWindows = (
  o: { ffmpegVersion?: string; driver?: string } = {}
) => {
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
