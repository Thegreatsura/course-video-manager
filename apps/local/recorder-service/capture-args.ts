import {
  silenceRule,
  silencedetectFilter,
  type SilenceLength,
} from "../app/silence-detection-constants";
import {
  MOTION_FILTERS,
  MOTION_KEY,
} from "../app/packages/clap-detection/live";

/**
 * THE CAPTURE, AS THE RIG (#1992) PROVED IT: two ffmpeg.exe processes writing
 * three files for one Recording Session.
 *
 *   screen process:        ddagrab (the DELL for Landscape, the Spacedesk
 *                          display for a Short; whole output) -> screen.mkv
 *                          (none for a Short whose display is unavailable)
 *   camera + mic process:  Cam Link 4K -> camera.mkv, mic -> mic.mkv,
 *                          and silencedetect on the mic audio it writes
 *
 * Screen and camera are separate processes: any second GPU stream in the
 * screen's process (camera upload, scale or NVENC) made ddagrab miss frames,
 * 55-58 fps against 59.7-59.8 split.
 *
 * ONE SHARED CLOCK. Every input is stamped with Windows wall time
 * (-use_wallclock_as_timestamps), -copyts keeps ffmpeg from zeroing each
 * input on its own, and every stream subtracts the same T0. File time t then
 * means wall time T0 + t in all three files. fps=…:start_time=0 and
 * aresample=…:first_pts=0 make each file CFR from exactly t=0. The mic's
 * stamps only anchor it: its audio is timed by sample count (`micOnClock`).
 *
 * PREVIEWS: every process that sees a picture also sends a small MJPEG of it
 * to the service (`previewOutput`), which serves it to the browser
 * (`preview-feeds.ts`). While the recorder is open but not recording, the
 * camera has a preview-only process of its own (`cameraPreviewArgs`); while
 * recording, the camera + mic process carries the camera preview. The screen
 * preview is always its own process (`screenPreviewArgs`): reading a D3D11
 * frame back in the screen recorder would cost it frames.
 */

export const FILE_NAMES = {
  screen: "screen.mkv",
  camera: "camera.mkv",
  mic: "mic.mkv",
} as const;

/** The 100 ns frame interval the Cam Link 4K advertises for 2160p29.97. */
export const CAM_LINK_FRAME_INTERVAL = 333667;

/**
 * The 100 ns frame interval ffmpeg's dshow input asks the device for, as
 * libavdevice/dshow.c (8.0) computes it: den * 10^7 / num, truncated. A format
 * whose interval range does not contain it is skipped, and with none left
 * ffmpeg fails "Could not set video options". 30000/1001 truncates to 333666,
 * one short of the Cam Link's 333667, so it never opened; "29.97" (read as
 * 2997/100) gives exactly 333667.
 */
export const dshowFrameInterval = (rate: string): number => {
  const [n, d = "1"] = rate.split("/");
  const dec = (x: string) => {
    const [i, f = ""] = x.split(".");
    return { num: BigInt(i + f), den: 10n ** BigInt(f.length) };
  };
  const a = dec(n ?? "0");
  const b = dec(d);
  return Number((b.num * a.den * 10_000_000n) / (a.num * b.den));
};

export const CAM_DSHOW_FRAMERATE = "29.97";

const BT709 =
  "setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709";

/**
 * OBS's "Landscape Recording": NVENC H.264, CQP 23, p5 + hq, High, 2
 * B-frames. GOP 2 s, so a crash loses at most one GOP.
 */
const nvenc = (gopFrames: number) => [
  "-c:v",
  "h264_nvenc",
  "-preset",
  "p5",
  "-tune",
  "hq",
  "-rc",
  "constqp",
  "-qp",
  "23",
  "-profile:v",
  "high",
  "-bf",
  "2",
  "-g",
  String(gopFrames),
  "-fps_mode",
  "passthrough",
];

/**
 * MKV, not fragmented MP4 (which put the first video frame two frames late),
 * with 1 s clusters: a cluster is held in memory until it closes, so the
 * cluster time bounds what a hard kill loses.
 */
const MKV = [
  "-cluster_time_limit",
  "1000",
  "-flush_packets",
  "1",
  "-f",
  "matroska",
];

const HEAD = [
  "-hide_banner",
  "-nostats",
  "-loglevel",
  "level+info",
  "-y",
  "-progress",
  "pipe:1",
  "-stats_period",
  "1",
  "-copyts",
];

const WALLCLOCK = [
  "-use_wallclock_as_timestamps",
  "1",
  "-thread_queue_size",
  "512",
];

/**
 * A preview output, as the rig (#1992) settled it: MJPEG to the service's TCP
 * feed for that picture. A preview consumer that dies or stalls must never
 * stop a recording, and a slow Windows -> WSL connect must not lose the
 * preview for good, so it sits behind tee's fifo: its own queue, packets
 * dropped when full, the connection retried every 0.5 s. The null output
 * keeps the tee alive.
 */
export const previewOutput = (port: number, quality = 7) => [
  "-c:v",
  "mjpeg",
  "-q:v",
  String(quality),
  "-f",
  "tee",
  "-use_fifo",
  "1",
  "-fifo_options",
  "attempt_recovery=1:recover_any_error=1:recovery_wait_time=0.5:max_recovery_attempts=0:drop_pkts_on_overflow=1:queue_size=30",
  `[f=mpjpeg:onfail=ignore]tcp://127.0.0.1:${port}?timeout=2000000|[f=null:use_fifo=0]-`,
];

/**
 * In each preview ffmpeg.exe's command line, so one left running by a service
 * that died can be found and stopped (`stop-recorders.ps1`). A preview never
 * exits by itself: its tee retries a dead feed for ever.
 */
export const PREVIEW_TAGS = {
  camera: "cvm-recorder-preview-camera",
  screen: "cvm-recorder-preview-screen",
} as const;

/** In the level meter's command line, for the same reason: it never exits by itself. */
export const METER_TAG = "cvm-recorder-meter";

const tagged = (tag: string) => ["-metadata", `comment=${tag}`];

const PREVIEW_HEAD = ["-hide_banner", "-nostats", "-loglevel", "level+warning"];

/** 640x360 off the GPU, for the browser. */
const CAMERA_PREVIEW_SCALE =
  "scale_cuda=640:360,hwdownload,format=nv12,format=yuvj420p";

/** The Cam Link 4K as DirectShow opens it, for recording and preview alike. */
const camLinkInput = (camera: string) => [
  "-f",
  "dshow",
  "-rtbufsize",
  "1500M",
  "-video_size",
  "3840x2160",
  "-framerate",
  CAM_DSHOW_FRAMERATE,
  "-pixel_format",
  "nv12",
  "-i",
  `video=${camera}`,
];

/**
 * The mic as DirectShow opens it (`MIC_NAME`, Voicemeeter Out B1), raw: no
 * filters, and a 20 ms device buffer keeps the stamp close to capture. The
 * recording and the level meter open it the same way, so the meter reads the
 * very signal mic.mkv gets.
 */
export const micInput = (mic: string) => [
  "-f",
  "dshow",
  "-audio_buffer_size",
  "20",
  "-sample_rate",
  "48000",
  "-channels",
  "2",
  "-i",
  `audio=${mic}`,
];

/**
 * The thumbnail camera's still (#2012): 1280x720, the size the OBS Virtual
 * Camera gave it, a few times a second at a high JPEG quality. Scaled on the
 * GPU like the preview; the rate is cut after the download, so no filter
 * here has to take CUDA frames that the preview's own chain does not.
 */
const CAMERA_STILL_SCALE =
  "scale_cuda=1280:720:interp_algo=bicubic,hwdownload,format=nv12,fps=4,format=yuvj420p";

/**
 * The camera while the recorder is open and not recording: the Cam Link in
 * the very mode the recording opens it in, to a preview only, plus the
 * thumbnail camera's still feed. Its first preview frame is how the service
 * knows the camera is live.
 */
export const cameraPreviewArgs = (o: {
  camera: string;
  port: number;
  stillPort: number;
}) => [
  ...PREVIEW_HEAD,
  ...camLinkInput(o.camera),
  "-filter_complex",
  `[0:v]hwupload_cuda,split[p][s];[p]${CAMERA_PREVIEW_SCALE}[prev];[s]${CAMERA_STILL_SCALE}[still]`,
  "-map",
  "[prev]",
  ...tagged(PREVIEW_TAGS.camera),
  ...previewOutput(o.port),
  "-map",
  "[still]",
  ...previewOutput(o.stillPort, 2),
];

/**
 * The screen preview's size: 540 tall, as wide as the screen's shape (even),
 * so the preview is never stretched: 960x540 for the DELL or a 1920x1080
 * Spacedesk display, 540x540 for a 1080x1080 one (ADR 0043).
 */
export const screenPreviewSize = (screen: {
  width: number;
  height: number;
}) => ({
  width: Math.round((540 * screen.width) / screen.height / 2) * 2,
  height: 540,
});

/**
 * The screen preview: a second Desktop Duplication session (Windows allows
 * several) in its own ffmpeg.exe, which can stall, crash or be stopped
 * without touching the screen recorder, at `screenPreviewSize`.
 */
export const screenPreviewArgs = (o: {
  screenIndex: number;
  port: number;
  /** The screen's own size, in pixels. */
  size: { width: number; height: number };
}) => [
  ...PREVIEW_HEAD,
  "-f",
  "lavfi",
  "-i",
  `ddagrab=output_idx=${o.screenIndex}:framerate=30,hwdownload,format=bgra,scale=${screenPreviewSize(o.size).width}:540,format=yuvj420p`,
  "-map",
  "0:v",
  ...tagged(PREVIEW_TAGS.screen),
  ...previewOutput(o.port),
];

/**
 * The camera (input 0) on the shared clock: wall time less T0, then CFR
 * 29.97 from exactly t=0. A Recording Session and an AV Calibration's run
 * both stamp it so, which is what makes a calibration's Mic Offset the
 * recording's.
 */
const cameraOnClock = (t0: string) =>
  `[0:v]setpts=PTS-${t0}/TB,fps=30000/1001:start_time=0`;

/**
 * How fast the mic's anchor may move later, in seconds per second of mic
 * audio: far above any sound card's clock error (tens of ppm), far below a
 * stall's (a 400 ms stall moves it 0.2 ms).
 */
const MIC_ANCHOR_RISE = 0.0005;

/** A mic buffer read this late (seconds) is logged as a stall. */
const MIC_STALL_LOGGED = 0.05;

/**
 * The mic (input 1) on the shared clock, timed by sample count (#2120).
 *
 * Its wall-time stamps cannot be trusted one by one: ffmpeg sometimes stops
 * reading the mic for 100-400 ms, then reads the backlog all stamped "now".
 * Following those stamps, aresample padded the gap with silence and was left
 * tens of ms out, a different amount every take. So a buffer's time is the
 * mic's anchor plus the samples before it. The anchor is the earliest time
 * any buffer so far says the mic started (its stamp less the samples before
 * it): a late buffer only ever says later, so a stall cannot move it. To
 * follow a sound card whose clock runs slow against Windows, it may creep
 * later by `MIC_ANCHOR_RISE`; aresample's async=50 follows the small steps
 * either way. With no stall a buffer keeps its stamp, give or take the
 * jitter in how soon ffmpeg reads it.
 *
 * Audio queued while the camera was opening arrives in one burst stamped
 * "now", before the anchor has settled: dropping the first 1.5 s (padded
 * back with silence by first_pts=0) keeps it from becoming an offset.
 * Recordings and AV Calibration runs both time the mic with this.
 *
 * The first buffer of a stall (read more than `MIC_STALL_LOGGED` late)
 * logs how late it was as a bare number of seconds ("[info] 0.391306"), so
 * a take's ffmpeg log still shows the stalls its mic file no longer does.
 */
export const micOnClock = (t0: string, input = "1:a") => {
  const startedAt = `PTS*TB-${t0}-N/SR`;
  const anchor = `st(0,if(N,min(ld(0)+${MIC_ANCHOR_RISE}*(N-ld(1))/SR,${startedAt}),${startedAt}))`;
  // ld(2): how late this buffer was read; logged on the first of a stall.
  const late = `st(3,ld(2));st(2,${startedAt}-ld(0))`;
  const stallLog = `if(gt(ld(2),${MIC_STALL_LOGGED})*lte(ld(3),${MIC_STALL_LOGGED}),print(ld(2),32))`;
  return `[${input}]asetpts='${anchor};${late};${stallLog};st(1,N);(ld(0)+N/SR)/TB',atrim=start=1.5,aresample=async=50:min_hard_comp=0.1:first_pts=0`;
};

/**
 * AN AV CALIBRATION'S RUN (`calibration-run.ts`): one ffmpeg.exe, the Cam
 * Link and the mic stamped exactly as a Recording Session's camera + mic
 * process stamps them, so a clap's camera time less its mic time is the
 * recording's Mic Offset. The mic goes through ebur128 for the level meter's
 * readings (timed in mic file seconds: it counts the samples the file gets)
 * to `micFile`, raw PCM; the camera, scaled to 640x360 on the GPU (enough to
 * see hands meet), to `cameraFile`. Both tagged as the meter is, so a run
 * left behind can be found and stopped. The 640x360 picture is also read
 * for motion (`MOTION_FILTERS`, as the offline clap pass reads the file),
 * each frame's printed to the log, for the live clap marks (#2121).
 */
export const calibrationCaptureArgs = (o: {
  t0Ms: number;
  camera: string;
  mic: string;
  micFile: string;
  cameraFile: string;
}) => {
  const t0 = (o.t0Ms / 1000).toFixed(3);
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "level+info",
    "-y",
    "-copyts",
    ...WALLCLOCK,
    ...camLinkInput(o.camera),
    ...WALLCLOCK,
    ...micInput(o.mic),
    "-filter_complex",
    [
      `${cameraOnClock(t0)},hwupload_cuda,scale_cuda=640:360,split[cam][camm]`,
      `[camm]hwdownload,format=nv12,${MOTION_FILTERS.join(",")},metadata=mode=print:key=${MOTION_KEY},nullsink`,
      // framelog=info: ebur128 logs each 100 ms reading at info, not verbose.
      `${micOnClock(t0)},ebur128=framelog=info[mic]`,
    ].join(";"),
    "-map",
    "[mic]",
    "-c:a",
    "pcm_s16le",
    ...tagged(METER_TAG),
    o.micFile,
    "-map",
    "[cam]",
    ...nvenc(60),
    ...tagged(METER_TAG),
    ...MKV,
    o.cameraFile,
  ];
};

export type CaptureOptions = {
  t0Ms: number;
  /** Put in each file's metadata and command line, so a process can be found by it. */
  tag: string;
  /**
   * ddagrab's output_idx for the screen (the DELL, or a Short's Spacedesk
   * display); null records no screen (`screen` is then null too).
   */
  screenIndex: number | null;
  /** DirectShow names, as the device listing gave them. */
  camera: string;
  mic: string;
  silenceLength: SilenceLength;
  /** The silence threshold silencedetect cuts with, in dB. */
  thresholdDb: number;
  /** The service's camera preview feed, which this process also sends to. */
  cameraPreviewPort: number;
};

export const buildCaptureArgs = (o: CaptureOptions) => {
  const t0 = (o.t0Ms / 1000).toFixed(3);

  // dup_frames=1: with 0, ddagrab emits nothing while the screen is static,
  // which stalls the graph. Its pacing needs the 1 ms timer the service
  // raises right after start (timer-resolution.ps1).
  const screen =
    o.screenIndex === null
      ? null
      : [
          ...HEAD,
          ...WALLCLOCK,
          "-f",
          "lavfi",
          "-i",
          `ddagrab=output_idx=${o.screenIndex}:framerate=60:dup_frames=1:draw_mouse=1,settb=AVTB`,
          "-filter_complex",
          `[0:v]setpts=PTS-${t0}/TB,fps=60:start_time=0,${BT709},scale_d3d11=format=nv12[scr]`,
          "-map",
          "[scr]",
          ...nvenc(120),
          "-metadata",
          `comment=${o.tag}`,
          ...MKV,
          FILE_NAMES.screen,
        ];

  // The Cam Link 4K offers only 2160p29.97 or 1080p59.94 raw, so open 4K NV12
  // and scale to 1440p on the GPU: no 4K reaches the disk.
  const cameraIn = [...WALLCLOCK, ...camLinkInput(o.camera)];
  const micIn = [...WALLCLOCK, ...micInput(o.mic)];
  // silencedetect reads the very audio mic.mkv gets, so its times are mic
  // file time; anullsink ends that branch inside the graph.
  const silence = silencedetectFilter(
    silenceRule(o.silenceLength, o.thresholdDb)
  );
  const cameraGraph = [
    `${cameraOnClock(t0)},${BT709},` +
      "hwupload_cuda,scale_cuda=2560:1440:interp_algo=bicubic,split[cam][camp]",
    `[camp]${CAMERA_PREVIEW_SCALE}[camprev]`,
    `${micOnClock(t0)},asplit=2[mic][sd]`,
    `[sd]${silence},anullsink`,
  ].join(";");
  const camera = [
    ...HEAD,
    ...cameraIn,
    ...micIn,
    "-filter_complex",
    cameraGraph,
    "-map",
    "[cam]",
    ...nvenc(60),
    "-metadata",
    `comment=${o.tag}`,
    ...MKV,
    FILE_NAMES.camera,
    "-map",
    "[mic]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-metadata",
    `comment=${o.tag}`,
    ...MKV,
    FILE_NAMES.mic,
    "-map",
    "[camprev]",
    ...previewOutput(o.cameraPreviewPort),
  ];
  return { screen, camera };
};
