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
 * PREVIEWS: every process that sees a picture also sends it, full size, as
 * a low-latency H.264 stream (NVENC, or libx264 as a fallback) to the
 * service (`previewOutput`), which relays it to the browser
 * (`preview-feeds.ts`). While the recorder is open but not recording, the
 * camera has a preview-only process of its own (`cameraPreviewArgs`); while
 * recording, the camera + mic process sends camera.mkv's own packets as the
 * camera preview (`recordedAndPreviewed`), with no encoder of the preview's
 * own that could fail the take. The screen
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
 * camera.mkv's NVENC hands each frame on one frame behind, rather than
 * holding a queue of them (ffmpeg's default; the take's camera preview,
 * which is camera.mkv's stream (#2203), drew 510-550 ms late with it and
 * 286 ms at one frame, synthetic). The packets are the same either way
 * (same framemd5 at the default, 0, 1 and 2, synthetic 1440p29.97), and it
 * kept real time.
 */
const CAMERA_TAKE_DELAY = ["-delay", "1"];

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
 * Behind tee's fifo, as the rig (#1992) settled it: a preview consumer that
 * dies or stalls must never stop a recording, and a slow Windows -> WSL
 * connect must not lose the preview for good, so each feed has its own
 * queue, packets dropped when full, the connection retried every 0.5 s. The
 * null output keeps the tee alive. The socket sends each packet as soon as
 * it is written (no Nagle).
 */
const teeToFeed = (port: number, format: string, queueSize: number) =>
  teeWith(queueSize, `${feedSlave(port, format)}|[f=null:use_fifo=0]-`);

const teeWith = (queueSize: number, slaves: string) => [
  "-f",
  "tee",
  "-use_fifo",
  "1",
  "-fifo_options",
  `attempt_recovery=1:recover_any_error=1:recovery_wait_time=0.5:max_recovery_attempts=0:drop_pkts_on_overflow=1:queue_size=${queueSize}`,
  slaves,
];

const feedSlave = (port: number, format: string) =>
  `[f=${format}:onfail=ignore]tcp://127.0.0.1:${port}?timeout=2000000&tcp_nodelay=1`;

/**
 * A Footage file that is also a preview feed (#2203): the recording's own
 * encoded packets, written to `file` exactly as `MKV` writes them (no fifo,
 * and a failure there fails the recording, as it always has), and copied to
 * the service's feed in FLV behind the same dropping, retrying fifo as any
 * preview. No second encoder, so nothing about the preview (its encoder
 * failing, its consumer gone or stalled) can stop or slow the file. The
 * packets in the file are the ones a plain matroska output writes (checked:
 * the same framemd5, size and CodecPrivate, synthetic). Global headers, as
 * matroska asks for them anyway: FLV needs the SPS/PPS up front.
 */
export const recordedAndPreviewed = (file: string, port: number) => [
  "-flags",
  "+global_header",
  ...teeWith(
    8,
    `[f=matroska:use_fifo=0:onfail=abort:cluster_time_limit=1000:flush_packets=1]${file}|${feedSlave(port, "flv")}`
  ),
];

/**
 * What encodes a preview stream (#2194): NVENC, or libx264 on the CPU once
 * NVENC would not open for that feed (`preview-encoders.ts`).
 */
export type PreviewEncoder = "nvenc" | "x264";

/**
 * The preview's NVENC encode, tuned for latency: the fastest preset, the
 * ultra-low-latency tune, no B-frames, no lookahead, no reordering delay, a
 * keyframe exactly every `gopFrames` (IDR, no scene cuts). High profile and
 * 4:2:0 whatever comes in (the screen is BGRA), which WebCodecs decodes in
 * hardware. Constant QP 21 is near-transparent at preview size.
 */
const previewNvenc = (gopFrames: number) => [
  "-c:v",
  "h264_nvenc",
  "-preset",
  "p1",
  "-tune",
  "ull",
  "-zerolatency",
  "1",
  "-delay",
  "0",
  "-rc-lookahead",
  "0",
  "-bf",
  "0",
  "-rc",
  "constqp",
  "-qp",
  String(PREVIEW_QP),
  "-profile:v",
  "high",
  "-g",
  String(gopFrames),
  "-forced-idr",
  "1",
  "-no-scenecut",
  "1",
];

/**
 * The CPU fallback, as #2192 shipped it: libx264 ultrafast + zerolatency,
 * no B-frames, no lookahead, each frame out as soon as it is in.
 */
const previewX264 = (gopFrames: number) => [
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-tune",
  "zerolatency",
  "-crf",
  String(PREVIEW_CRF),
  "-pix_fmt",
  "yuv420p",
  "-g",
  String(gopFrames),
  "-x264-params",
  `keyint_min=${gopFrames}:scenecut=0:threads=${PREVIEW_THREADS}`,
];

/**
 * A preview output: the picture at full size as a low-latency H.264 stream
 * to the service's TCP feed for it (#2192), which relays it to the browser
 * to decode in hardware (`preview-feeds.ts`). On NVENC (#2194), with libx264
 * as the fallback (`PreviewEncoder`). A keyframe a second, so a browser that
 * joins late (or loses a packet) is whole within a second. In FLV, whose
 * tags carry their own lengths: the service hands a frame on the moment its
 * last byte is in, with no container to wait on.
 *
 * The fifo may hold a few frames: a dropped packet breaks the picture until
 * the next keyframe, so it drops only when the service has stopped reading.
 */
export const previewOutput = (
  port: number,
  gopFrames: number,
  encoder: PreviewEncoder
) => [
  "-fps_mode",
  "passthrough",
  ...(encoder === "nvenc" ? previewNvenc(gopFrames) : previewX264(gopFrames)),
  // The tee hides FLV's need for the SPS/PPS up front: ask for them.
  "-flags",
  "+global_header",
  ...teeToFeed(port, "flv", 8),
];

/** libx264's quality: near-transparent, the preview is not to look any softer than the Footage. */
const PREVIEW_CRF = 18;

/** NVENC's: about libx264's CRF 18 at the preview's sizes. */
const PREVIEW_QP = 21;

/** libx264's threads per preview: enough for 1440p30 or 1080p60 in real time, short of every core. */
const PREVIEW_THREADS = 4;

/**
 * The thumbnail camera's still feed: MJPEG at high quality, the latest of
 * which the service keeps (`GET /still`). It is never drawn live, so each
 * JPEG stands alone and the fifo holds two at most.
 */
const stillOutput = (port: number) => [
  "-fps_mode",
  "passthrough",
  "-c:v",
  "mjpeg",
  "-q:v",
  "2",
  ...teeToFeed(port, "mpjpeg", 2),
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

/**
 * The camera preview at the size camera.mkv gets (1440p), scaled on the GPU
 * as the recording scales it. NVENC takes the CUDA frame as it is; libx264
 * needs it down on the CPU.
 */
const cameraPreviewScale = (encoder: PreviewEncoder) =>
  `scale_cuda=2560:1440:interp_algo=bicubic${encoder === "nvenc" ? "" : ",hwdownload,format=nv12"}`;

/** A keyframe a second at the Cam Link's 29.97 fps. */
const CAMERA_PREVIEW_GOP = 30;

/**
 * How many bytes of frames DirectShow may hold for ffmpeg: 4K NV12 is 12.4 MB
 * a frame. A recording must never drop one, so it may hold about four
 * seconds' worth. The preview-only process holds about five frames (#2144):
 * a preview that falls behind drops frames instead of showing them late.
 */
const RTBUF = { recording: "1500M", preview: "64M" } as const;

/** The Cam Link 4K as DirectShow opens it, for recording and preview alike. */
const camLinkInput = (camera: string, rtbuf: string = RTBUF.recording) => [
  "-f",
  "dshow",
  "-rtbufsize",
  rtbuf,
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
  encoder: PreviewEncoder;
}) => [
  ...PREVIEW_HEAD,
  ...camLinkInput(o.camera, RTBUF.preview),
  "-filter_complex",
  `[0:v]hwupload_cuda,split[p][s];[p]${cameraPreviewScale(o.encoder)}[prev];[s]${CAMERA_STILL_SCALE}[still]`,
  "-map",
  "[prev]",
  ...tagged(PREVIEW_TAGS.camera),
  ...previewOutput(o.port, CAMERA_PREVIEW_GOP, o.encoder),
  "-map",
  "[still]",
  ...stillOutput(o.stillPort),
];

/**
 * The screen preview: a second Desktop Duplication session (Windows allows
 * several) in its own ffmpeg.exe, which can stall, crash or be stopped
 * without touching the screen recorder. At the screen's own size and 60
 * fps, as the screen is recorded and as OBS previews it: nothing is scaled
 * (#2192). For NVENC (#2194) the frame stays on the GPU, made NV12 there as
 * the screen recorder makes it: NVENC fed BGRA converts each frame itself
 * and fell behind 60 fps (41-49 fps, synthetic). libx264 needs it down on
 * the CPU.
 */
/** What the screen preview does to ddagrab's D3D11 BGRA frame before its encoder. */
export const SCREEN_PREVIEW_CHAIN: Record<PreviewEncoder, string> = {
  nvenc: "scale_d3d11=format=nv12",
  x264: "hwdownload,format=bgra",
};

export const screenPreviewArgs = (o: {
  screenIndex: number;
  port: number;
  encoder: PreviewEncoder;
}) => [
  ...PREVIEW_HEAD,
  "-f",
  "lavfi",
  "-i",
  `ddagrab=output_idx=${o.screenIndex}:framerate=60,${SCREEN_PREVIEW_CHAIN[o.encoder]}`,
  "-map",
  "0:v",
  ...tagged(PREVIEW_TAGS.screen),
  ...previewOutput(o.port, 60, o.encoder),
];

/** The camera (input 0) stamped in file time: wall time less T0. */
const cameraOnT0 = (t0: string) => `[0:v]setpts=PTS-${t0}/TB`;

/** CFR 29.97 from exactly t=0. */
const CAMERA_CFR = "fps=30000/1001:start_time=0";

/**
 * The camera (input 0) on the shared clock: wall time less T0, then CFR
 * 29.97 from exactly t=0. A Recording Session and an AV Calibration's run
 * both stamp it so, which is what makes a calibration's Mic Offset the
 * recording's.
 */
const cameraOnClock = (t0: string) => `${cameraOnT0(t0)},${CAMERA_CFR}`;

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
  /** The service's camera preview feed, which this process also sends camera.mkv's stream to. */
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
  // The camera preview during a take is camera.mkv's own stream
  // (`recordedAndPreviewed`, #2203): a preview encoder of its own in this
  // process could fail the whole process, and the take with it.
  const cameraGraph = [
    `${cameraOnT0(t0)},hwupload_cuda,${CAMERA_CFR},${BT709},scale_cuda=2560:1440:interp_algo=bicubic[cam]`,
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
    ...CAMERA_TAKE_DELAY,
    "-metadata",
    `comment=${o.tag}`,
    ...recordedAndPreviewed(FILE_NAMES.camera, o.cameraPreviewPort),
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
  ];
  return { screen, camera };
};
