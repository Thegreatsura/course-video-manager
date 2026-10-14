import { Effect } from "effect";
import type { FFmpegCommandsService } from "./ffmpeg-commands";
import {
  isLongEnoughForClip,
  silenceRule,
  DEFAULT_SILENCE_LENGTH,
  DEFAULT_SILENCE_THRESHOLD_DB,
  AUTO_EDITED_END_PADDING_SECONDS,
  type SilenceLength,
} from "@/silence-detection-constants";

/** One stretch of speech, in the Footage file's own time (seconds). */
export interface SpeechSegment {
  readonly startTime: number;
  readonly endTime: number;
}

/**
 * The one rule for what of some speech becomes a Clip, whichever Recorder
 * found it: speech shorter than the minimum Clip length is dropped
 * (`isLongEnoughForClip`, the rule the CVM recorder starts a Take by), and the
 * rest is snapped to the picture's frames, padded at the end so a cut never
 * lands on the last syllable, and rounded to hundredths.
 */
export function speechToClipBounds(
  speech: readonly SpeechSegment[],
  fps: number
): SpeechSegment[] {
  const endPaddingFrames = Math.round(AUTO_EDITED_END_PADDING_SECONDS * fps);
  return speech
    .filter((s) => isLongEnoughForClip(s.startTime, s.endTime))
    .map((s) => {
      const startFrame = Math.max(0, Math.round(s.startTime * fps));
      const endFrame = Math.round(s.endTime * fps) + endPaddingFrames;
      return {
        startTime: Math.round((startFrame / fps) * 100) / 100,
        endTime: Math.round((endFrame / fps) * 100) / 100,
      };
    });
}

/**
 * Pure function that parses ffmpeg silencedetect output into speech: what lies
 * between one silence's end and the next silence's start.
 */
export function parseSpeechFromFFmpeg(rawOutput: string): SpeechSegment[] {
  // Parse silence periods from ffmpeg output
  const silencePeriods: { start: number; end: number }[] = [];
  const lines = rawOutput.split("\n");

  let currentSilenceStart: number | null = null;

  for (const line of lines) {
    if (!line.includes("[silencedetect @")) continue;

    // ffmpeg reports a slightly-negative silence_start (e.g. -0.000166667)
    // whenever a file opens in silence, which every OBS recording does. The
    // sign has to be inside the capture or the line fails to match at all, the
    // leading silence period is dropped, and it merges with the first spoken
    // take — losing the first clip of the recording.
    const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/);
    const endMatch = line.match(/silence_end:\s*(-?[\d.]+)/);

    if (startMatch) {
      currentSilenceStart = Math.max(0, Number(startMatch[1]));
    }

    if (endMatch && currentSilenceStart !== null) {
      silencePeriods.push({
        start: currentSilenceStart,
        end: Number(endMatch[1]),
      });
      currentSilenceStart = null;
    }
  }

  return silencePeriods.slice(0, -1).map((silence, i) => ({
    startTime: silence.end,
    endTime: silencePeriods[i + 1]!.start,
  }));
}

/**
 * Runs ffmpeg silence detection and parses the output into clip boundaries.
 * Takes an FFmpegCommandsService instance directly to avoid leaking Effect requirements.
 *
 * `thresholdDb`: the threshold the take was recorded under (an OBS file's
 * after-recording pass). Absent, for work that is not recording (chunking
 * old Footage): the fixed default.
 */
export function findSilenceInVideo(
  ffmpeg: FFmpegCommandsService,
  inputVideo: string,
  opts?: {
    startTime?: number;
    silenceLength?: SilenceLength;
    thresholdDb?: number;
  }
) {
  return Effect.gen(function* () {
    const fps = yield* ffmpeg.getFPS(inputVideo);

    const rawOutput = yield* ffmpeg.detectSilence(inputVideo, {
      rule: silenceRule(
        opts?.silenceLength ?? DEFAULT_SILENCE_LENGTH,
        opts?.thresholdDb ?? DEFAULT_SILENCE_THRESHOLD_DB
      ),
      startTime: opts?.startTime,
    });

    const bounds = speechToClipBounds(parseSpeechFromFFmpeg(rawOutput), fps);

    // Add back the startTime offset so timestamps are absolute file positions,
    // not relative to the ffmpeg seek point (-ss flag)
    const startTimeAdjustment = opts?.startTime ?? 0;

    const clips = bounds.map((clip) => ({
      inputVideo,
      startTime: clip.startTime + startTimeAdjustment,
      endTime: clip.endTime + startTimeAdjustment,
    }));

    return { clips };
  });
}
