/**
 * Preview latency: how far behind the moment a frame was made the recorder's
 * live preview shows it in a browser (#2144).
 *
 *   pnpm --filter @cvm/local preview-latency [--scenario camera|screen|screen-square|recording|floor|all]
 *     [--seconds 10] [--client pull|multipart]
 *
 * Synthetic sources only: no capture device, no screen. Each scenario takes
 * the real ffmpeg.exe arguments (`capture-args.ts`) and swaps the device
 * input for a synthetic one of the same size and rate with the time it was
 * made burned in (`sourceArgs`). ffmpeg.exe then sends the preview through
 * the real tee to the real preview feeds (`preview-feeds.ts`), and a
 * headless Chromium draws it as the editor's composite does, reading the
 * time back each animation frame: latency = when a frame is first drawn
 * less the time burned into it.
 *
 *   camera     the Cam Link's preview-only process (`cameraPreviewArgs`), 4K NV12 in
 *   screen     the screen preview process (`screenPreviewArgs`), 1440p BGRA in
 *   screen-square  the same for a Short's 1080x1080 Spacedesk display
 *              (ADR 0043), previewed at 540x540
 *   recording  the camera + mic process of a Recording Session
 *              (`buildCaptureArgs`), which writes its camera.mkv and mic.mkv
 *              to a temporary folder, deleted after
 *   floor      a 640x360 source straight to the preview output: what any
 *              frame costs (the pipe in, encode, tee, TCP, browser), for
 *              reading the others against
 *
 * `--client multipart` reads the feed the old way (`<img>` on a
 * multipart/x-mixed-replace stream), for comparing against a service that
 * still serves it. Uses the GPU (CUDA, NVENC) for camera and recording.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  buildCaptureArgs,
  cameraPreviewArgs,
  previewOutput,
  screenPreviewArgs,
} from "../recorder-service/capture-args";
import { startPreviewFeeds } from "../recorder-service/preview-feeds";
import { findFfmpegExe } from "../recorder-service/windows-launcher";

const SCENARIOS = [
  "floor",
  "camera",
  "screen",
  "screen-square",
  "recording",
] as const;

/** Each screen scenario's synthetic screen, at its device's size. */
const SCREENS = {
  screen: { width: 2560, height: 1440 },
  "screen-square": { width: 1080, height: 1080 },
} as const;
const isScreen = (s: Scenario): s is keyof typeof SCREENS => s in SCREENS;
type Scenario = (typeof SCENARIOS)[number];

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const scenarioFlag = flag("--scenario", "all");
const seconds = Number(flag("--seconds", "10"));
const client = flag("--client", "pull") as "pull" | "multipart";
const WARMUP_SECONDS = 3;

/**
 * The synthetic camera or screen: Linux ffmpeg in WSL draws 28 bits of the
 * WSL wall clock in ms (a 7x4 grid of 40 px blocks) into a 320x180 frame,
 * and pipes it raw into ffmpeg.exe in place of the device; ffmpeg.exe scales
 * it up to the device's size with no smoothing. The browser reads the clock
 * back in WSL too, so one clock is on both ends (the Windows and WSL clocks
 * can be 100 ms apart, and wander). Frame n is stamped with the time it is
 * due (first frame + n / rate), not the time it gets made: like a capture
 * device, a frame the pipeline is late to take has been waiting, and that
 * wait is latency.
 */
const BITS = 28;
const sourceArgs = (rate: string) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  `color=c=black:s=320x180:r=${rate},settb=AVTB,` +
    "setpts='if(eq(N\\,0)\\,st(0\\,RTCTIME-PTS)\\,0);PTS+ld(0)',realtime," +
    "geq=lum='if(between(X\\,20\\,299)*between(Y\\,10\\,169)\\," +
    "255*mod(floor(floor(T*1000)/pow(2\\,floor((X-20)/40)+7*floor((Y-10)/40)))\\,2)\\,0)'" +
    ":cb=128:cr=128",
  "-f",
  "rawvideo",
  "-pix_fmt",
  "yuv420p",
  "pipe:1",
];

/** ffmpeg.exe's side of the pipe. */
const pipedInput = (rate: string) => [
  "-f",
  "rawvideo",
  "-pix_fmt",
  "yuv420p",
  "-video_size",
  "320x180",
  "-framerate",
  rate,
  "-i",
  "pipe:0",
];

/** Scales the piped source up to a device's size and format. */
const upscale = (size: string, format: string) =>
  `scale=${size.replace("x", ":")}:flags=neighbor,format=${format}`;

const CAMERA_RATE = "30000/1001";

/**
 * The piped source made the Cam Link's 4K NV12. On the GPU and back, not
 * swscale: a 4K CPU scale costs about as long as a frame lasts, so ffmpeg.exe
 * could never catch up on a backlog the way it does reading the real device.
 */
const TO_4K =
  "format=nv12,hwupload_cuda,scale_cuda=3840:2160:interp_algo=nearest,hwdownload,format=nv12";

const SYNTH_MIC =
  "sine=f=440:sample_rate=48000:samples_per_frame=960,arealtime,aformat=channel_layouts=stereo";

/**
 * Swaps each DirectShow input (`-f dshow … -i video=…|audio=…`) for a
 * synthetic one: the camera piped in and scaled up to 4K NV12 at the head of
 * each filter graph that reads it, the mic a lavfi tone.
 */
const withoutDevices = (argv: readonly string[]) => {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-f" && argv[i + 1] === "dshow") {
      let j = i;
      while (argv[j] !== "-i") j++;
      const device = argv[j + 1] ?? "";
      out.push(
        ...(device.startsWith("video=")
          ? pipedInput(CAMERA_RATE)
          : ["-f", "lavfi", "-i", SYNTH_MIC])
      );
      i = j + 1;
      continue;
    }
    if (argv[i - 1] === "-vf") {
      out.push(`${TO_4K},${argv[i]}`);
      continue;
    }
    if (argv[i - 1] === "-filter_complex") {
      out.push(
        `[0:v]${TO_4K}[synth];` + argv[i]!.replaceAll("[0:v]", "[synth]")
      );
      continue;
    }
    out.push(argv[i]!);
  }
  return out;
};

const ffmpegArgs = (
  scenario: Scenario,
  port: number,
  stillPort: number,
  t0Ms: number
): string[] => {
  switch (scenario) {
    case "floor":
      return [
        "-hide_banner",
        "-loglevel",
        "warning",
        ...pipedInput(CAMERA_RATE),
        "-vf",
        upscale("640x360", "yuvj420p"),
        "-map",
        "0:v",
        ...previewOutput(port),
      ];
    case "camera":
      return withoutDevices(
        cameraPreviewArgs({ camera: "synthetic", port, stillPort })
      );
    case "screen":
    case "screen-square": {
      // ddagrab's lavfi input becomes the pipe, and what followed its
      // download a filter on the pipe. The 320x180 clock is stretched to the
      // screen's shape and back, so the browser still reads it whole.
      const size = SCREENS[scenario];
      const argv = screenPreviewArgs({ screenIndex: 0, port, size });
      const at = argv.findIndex((a) => a.startsWith("ddagrab="));
      const after = argv[at]!.replace(
        /^ddagrab=[^,]*,hwdownload,format=bgra,/,
        ""
      );
      return [
        ...argv.slice(0, at - 3),
        ...pipedInput("30"),
        "-vf",
        `${upscale(`${size.width}x${size.height}`, "bgra")},${after}`,
        ...argv.slice(at + 1),
      ];
    }
    case "recording":
      return withoutDevices(
        buildCaptureArgs({
          t0Ms,
          tag: "cvm-preview-latency",
          screenIndex: null,
          camera: "synthetic",
          mic: "synthetic",
          silenceLength: "short",
          thresholdDb: -40,
          cameraPreviewPort: port,
        }).camera
      );
  }
};

const page = (o: { feed: string; client: string }) => `<!doctype html>
<canvas id="c" width="320" height="180"></canvas>
<script type="module">
const BITS = ${BITS};
const MOD = 2 ** BITS;
const ctx = document.getElementById("c").getContext("2d", { willReadFrequently: true });
let source;
${
  o.client === "multipart"
    ? `const img = document.createElement("img");
img.crossOrigin = "anonymous";
img.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
img.src = "/preview/${o.feed}";
document.body.append(img);
const current = () => (img.naturalWidth > 0 ? img : undefined);`
    : `const { watchLatestFrame } = await import("/frame-loop.js");
let bitmap;
watchLatestFrame("/preview/${o.feed}", (b) => { bitmap?.close(); bitmap = b; });
const current = () => bitmap;`
}
window.__latencies = [];
let last = -1;
const draw = () => {
  requestAnimationFrame(draw);
  const src = current();
  if (!src) return;
  ctx.drawImage(src, 0, 0, 320, 180);
  const px = ctx.getImageData(0, 0, 320, 180).data;
  let v = 0;
  for (let k = 0; k < BITS; k++) {
    const x = 20 + (k % 7) * 40 + 20, y = 10 + Math.floor(k / 7) * 40 + 20;
    if (px[(y * 320 + x) * 4] > 128) v += 2 ** k;
  }
  if (v === last) return;
  last = v;
  const now = Date.now() % MOD;
  window.__latencies.push(((now - v) % MOD + MOD) % MOD);
};
draw();
</script>`;

const frameLoopJs = async () => {
  const { transformWithEsbuild } = await import("vite");
  const file = path.join(
    import.meta.dirname,
    "../app/features/video-editor/latest-frame.ts"
  );
  const { code } = await transformWithEsbuild(
    fs.readFileSync(file, "utf8"),
    file,
    { loader: "ts", format: "esm" }
  );
  return code;
};

/** The time burned into a JPEG, read with Linux ffmpeg. */
const stampOf = (jpeg: Buffer) => {
  const gray = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "mjpeg",
      "-i",
      "-",
      "-vf",
      "scale=320:180",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { input: jpeg }
  );
  let v = 0;
  for (let k = 0; k < BITS; k++) {
    const x = 20 + (k % 7) * 40 + 20;
    const y = 10 + Math.floor(k / 7) * 40 + 20;
    if (gray[y * 320 + x]! > 128) v += 2 ** k;
  }
  return v;
};

const sinceStamp = (atMs: number, stamp: number) => {
  const mod = 2 ** BITS;
  return ((((atMs % mod) - stamp) % mod) + mod) % mod;
};

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    frames: s.length,
    fps: Number((s.length / seconds).toFixed(1)),
    medianMs: at(0.5),
    p90Ms: at(0.9),
    maxMs: s[s.length - 1],
  };
};

const measure = async (scenario: Scenario) => {
  const exe = findFfmpegExe();
  if (!exe) throw new Error("ffmpeg.exe not found");
  const feeds = await startPreviewFeeds();
  const js = client === "pull" ? await frameLoopJs() : "";
  const feed = isScreen(scenario) ? "screen" : "camera";
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(page({ feed, client }));
      return;
    }
    if (req.url === "/frame-loop.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(js);
      return;
    }
    if (!feeds.serve(req, res, {})) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const httpPort = (server.address() as { port: number }).port;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-latency-"));
  const ff = spawn(
    exe,
    ffmpegArgs(scenario, feeds.port(feed), feeds.port("still"), Date.now()),
    { cwd: dir, stdio: ["pipe", "ignore", "pipe"] }
  );
  let log = "";
  ff.stderr.on(
    "data",
    (d: Buffer) => (log = (log + d.toString()).slice(-4000))
  );
  ff.stdin.on("error", () => {});
  const ffClosed = new Promise<void>((r) => ff.once("close", () => r()));
  const source = spawn(
    "ffmpeg",
    sourceArgs(isScreen(scenario) ? "30" : CAMERA_RATE),
    { stdio: ["ignore", "pipe", "inherit"] }
  );
  source.stdout.pipe(ff.stdin);

  // Every 10th frame the service gets while measuring, and when it got it.
  const arrivals: { atMs: number; jpeg: Buffer }[] = [];
  let measuring = false;
  let count = 0;
  const unsubscribe = feeds.onFrame(feed, () => {
    const latest = feeds.latest(feed);
    if (measuring && latest && count++ % 10 === 0) arrivals.push(latest);
  });

  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    await tab.goto(`http://127.0.0.1:${httpPort}/`, { waitUntil: "commit" });
    await new Promise((r) => setTimeout(r, WARMUP_SECONDS * 1000));
    await tab.evaluate(() => {
      (window as unknown as { __latencies: number[] }).__latencies = [];
    });
    measuring = true;
    await new Promise((r) => setTimeout(r, seconds * 1000));
    measuring = false;
    const latencies = await tab.evaluate(
      () => (window as unknown as { __latencies: number[] }).__latencies
    );
    if (latencies.length === 0)
      throw new Error(`${scenario}: no frames drawn. ffmpeg said:\n${log}`);
    const atService = arrivals.map((a) => sinceStamp(a.atMs, stampOf(a.jpeg)));
    return {
      ...stats(latencies),
      serviceMedianMs: stats(atService).medianMs,
    };
  } finally {
    unsubscribe();
    await browser.close();
    // The source ending ends ffmpeg.exe's input, and so ffmpeg.exe.
    source.kill();
    const kill = setTimeout(() => ff.kill("SIGKILL"), 5000);
    await ffClosed;
    clearTimeout(kill);
    server.closeAllConnections();
    server.close();
    await feeds.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const chosen: readonly Scenario[] =
  scenarioFlag === "all" ? SCENARIOS : [scenarioFlag as Scenario];
const results: Record<string, Awaited<ReturnType<typeof measure>>> = {};
for (const scenario of chosen) {
  results[scenario] = await measure(scenario);
  console.error(scenario, JSON.stringify(results[scenario]));
}
console.table(results);
