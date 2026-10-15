import type { FramesLost } from "./protocol";

/**
 * FRAMES LOST in one Recording Session (#2214): the Cam Link's dshow buffer
 * drops, any gap in the frames reaching the writer (the Cam Link skipping,
 * or the relay dropping what the writer could not take), and any gap in
 * ddagrab's frames reaching the screen recorder. The CFR filters fill each
 * gap with repeats, so each is a freeze in the file.
 *
 * Every loss is told (`tell`) so the editor can alert mid-take: the first at
 * once, a burst after it (dshow drops come in runs) at most once per
 * `FRAMES_LOST_PERIOD_MS`, with the latest totals.
 */

/** How often, at most, a burst of lost frames is told. */
export const FRAMES_LOST_PERIOD_MS = 500;

/** The Cam Link's frame rate: how many frames a gap the writer logs was. */
export const CAMERA_FPS = 30000 / 1001;

/** The screen recorder's frame rate, for the same. */
const SCREEN_FPS = 60;

/** A gap the writer or screen recorder logged, in seconds (`FRAME_GAP_SECONDS`). */
const GAP = /\[warning\] -(\d+(?:\.\d+)?)\s*$/;

/** A dshow drop from the Cam Link's real-time buffer (not the mic's). */
const CAMERA_BUFFER_DROP = /real-time buffer .*\[video input\].*frame dropped/;

/** Frames missing in a gap of `seconds` at `fps`. */
const missingIn = (seconds: string, fps: number) =>
  Math.max(1, Math.round(Number(seconds) * fps) - 1);

export const countFramesLost = (o: {
  /** False for a camera-only Short: its screen's are null, not 0. */
  screenCaptured: boolean;
  /** The take's file time now, for the log line. */
  fileTime: () => number;
  /** Tells the totals so far. */
  tell: (lost: FramesLost) => void;
}) => {
  let cameraBufferDrops = 0;
  let cameraGapFrames = 0;
  let screenGapFrames = 0;
  let stopped = false;
  let lastToldMs = -Infinity;
  let tellLater: ReturnType<typeof setTimeout> | undefined;

  const totals = (): FramesLost => ({
    camera: cameraBufferDrops + cameraGapFrames,
    screen: o.screenCaptured ? screenGapFrames : null,
  });

  const lost = () => {
    if (stopped || tellLater) return;
    const tell = () => {
      tellLater = undefined;
      if (stopped) return;
      lastToldMs = Date.now();
      o.tell(totals());
    };
    const wait = lastToldMs + FRAMES_LOST_PERIOD_MS - Date.now();
    if (wait <= 0) tell();
    else tellLater = setTimeout(tell, wait);
  };

  /** Frames missing in a gap line from `file`; null when the line is no gap. */
  const gapLine = (
    line: string,
    file: "camera.mkv" | "screen.mkv",
    fps: number,
    where: string
  ): number | null => {
    const gap = line.match(GAP);
    if (!gap) return null;
    const missing = missingIn(gap[1]!, fps);
    console.error(
      `recorder: ${file} is missing about ${missing} frame(s) at ${o.fileTime().toFixed(1)} s: a ${gap[1]} s gap in ${where}`
    );
    return missing;
  };

  return {
    /** A line the camera capture printed. */
    captureLine: (line: string) => {
      if (!CAMERA_BUFFER_DROP.test(line)) return;
      cameraBufferDrops += 1;
      lost();
    },
    /** A line the writer printed: true when it was a gap (and nothing else). */
    writerLine: (line: string): boolean => {
      const missing = gapLine(
        line,
        "camera.mkv",
        CAMERA_FPS,
        "the Cam Link's frames reaching the writer"
      );
      if (missing === null) return false;
      cameraGapFrames += missing;
      lost();
      return true;
    },
    /** A line the screen recorder printed. */
    screenLine: (line: string) => {
      const missing = gapLine(
        line,
        "screen.mkv",
        SCREEN_FPS,
        "the screen's frames"
      );
      if (missing === null) return;
      screenGapFrames += missing;
      lost();
    },
    /** Stops telling; `recording-stopped` reports the final totals. */
    stop: () => {
      stopped = true;
      clearTimeout(tellLater);
    },
    totals,
    /** What `recording-stopped` says went missing, file by file. */
    errors: (): string[] => [
      ...(cameraGapFrames > 0
        ? [
            `camera.mkv is missing about ${cameraGapFrames} frame(s): gaps in the Cam Link's frames reaching the writer (ffmpeg-camera.log).`,
          ]
        : []),
      ...(screenGapFrames > 0
        ? [
            `screen.mkv is missing about ${screenGapFrames} frame(s): gaps in the screen's frames (ffmpeg-screen.log).`,
          ]
        : []),
    ],
  };
};
