import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Fiber, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { SidecarContextTest } from "@/services/sidecar-context";
import type { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import {
  transcribeFootage,
  type TranscribeFootageOptions,
} from "@/services/footage-transcription";
import { FOOTAGE_TARGET_CHUNK_SECONDS } from "@/services/footage-chunking";
import { FOOTAGE_TRANSCRIPTION_EVENTS } from "@/features/jobs/transcribe-footage-job";
import { partialDirFor } from "../footage-chunk-cache";
import type { JobContext } from "../job-kind";
import { transcribeFootageJobKind } from "./transcribe-footage";

// The `transcribe-footage` Job over the REAL chunking orchestration and the
// REAL on-disk chunk cache; only ffmpeg and Whisper are faked. A long file
// (audio over Whisper's 25MB) is three chunks here.

const DURATION = FOOTAGE_TARGET_CHUNK_SECONDS * 3 - 60;

let dir: string;
let footage: string;
/** The start of every chunk Whisper was asked for, in order. */
let whisperCalls: number[];
/** A chunk start Whisper never answers for (a run cut off mid-chunk). */
let hangAt: number | null;
/** How often the full audio was extracted, and silence detected. */
let fullExtractions: number;
let silenceDetections: number;

beforeEach(() => {
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-footage-job-"));
  footage = nodePath.join(dir, "take.mkv");
  nodeFs.writeFileSync(footage, "the footage bytes");
  whisperCalls = [];
  hangAt = null;
  fullExtractions = 0;
  silenceDetections = 0;
});

afterEach(() => {
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

const ffmpegCommands = {
  getVideoDurationInSeconds: () => Effect.succeed(DURATION),
  getFPS: () => Effect.succeed(30),
  // No silence: the chunks are cut at the target length.
  detectSilence: () =>
    Effect.sync(() => {
      silenceDetections++;
      return "";
    }),
} as unknown as FFmpegCommandsService;

/** "ffmpeg": a sparse file, over 25MB for the whole file, tiny for a chunk. */
const extractAudio = (
  _video: string,
  range: { startTime: number; duration: number } | undefined
) =>
  Effect.sync(() => {
    if (!range) fullExtractions++;
    const out = nodePath.join(
      dir,
      `audio-${range ? range.startTime : "full"}-${Math.random()}.mp3`
    );
    nodeFs.writeFileSync(out, "");
    nodeFs.truncateSync(out, range ? 1024 : 26 * 1024 * 1024);
    return out;
  });

/** "Whisper": one word per chunk, at the chunk's own 0s. */
const transcribeAudioFile = (audioPath: string) =>
  Effect.suspend(() => {
    const start = Number(/audio-([\d.]+)-/.exec(audioPath)?.[1]);
    whisperCalls.push(start);
    return start === hangAt
      ? Effect.never
      : Effect.succeed({
          words: [{ start: 0, end: 1, text: `w${start}` }],
          segments: [{ start: 0, end: 1, text: `chunk at ${start}` }],
        });
  });

const fakeWhisper = Layer.succeed(WhisperTranscriptionService, {
  transcribeFootageFile: (path: string, options?: TranscribeFootageOptions) =>
    transcribeFootage(
      { ffmpegCommands, extractAudio, transcribeAudioFile },
      path,
      options
    ),
} as unknown as WhisperTranscriptionService);

/** One run of the Job, its Job Events kept in `events`. */
const startRun = () => {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  let chunkSettled!: () => void;
  const firstChunk = new Promise<void>((r) => (chunkSettled = r));
  const ctx: JobContext = {
    jobId: "job-1",
    attempt: 1,
    maxAttempts: 1,
    enqueue: () => Effect.die("this kind starts no other Job"),
    emit: (type, data) =>
      Effect.sync(() => {
        events.push({ type, data });
        if (type === FOOTAGE_TRANSCRIPTION_EVENTS.chunkSettled) chunkSettled();
      }),
  };
  const fiber = Effect.runFork(
    transcribeFootageJobKind
      .runRaw({ path: footage }, ctx)
      .pipe(
        Effect.provide(
          Layer.mergeAll(fakeWhisper, NodeContext.layer, SidecarContextTest)
        )
      )
  );
  return { fiber, events, firstChunk };
};

describe("the transcribe-footage Job", () => {
  it("writes the transcript beside the file and reports what the CLI prints", async () => {
    const run = startRun();
    await Effect.runPromise(Fiber.join(run.fiber));

    const sidecar = JSON.parse(
      nodeFs.readFileSync(`${footage}.transcript.json`, "utf8")
    );
    // Each chunk's word, moved onto the file's own timeline.
    expect(sidecar.words.map((w: { start: number }) => w.start)).toEqual([
      0,
      FOOTAGE_TARGET_CHUNK_SECONDS,
      FOOTAGE_TARGET_CHUNK_SECONDS * 2,
    ]);
    expect(run.events.at(-1)).toEqual({
      type: FOOTAGE_TRANSCRIPTION_EVENTS.transcribed,
      data: {
        path: footage,
        sidecar: `${footage}.transcript.json`,
        sourceHash: sidecar.sourceHash,
        transcribedAt: sidecar.transcribedAt,
        words: 3,
        segments: 3,
      },
    });
    // The chunk cache is gone once the transcript is written.
    expect(nodeFs.existsSync(partialDirFor(footage))).toBe(false);
  });

  it("resumes after a stop from the cached cut and chunks, redoing none of them", async () => {
    // Run 1: chunk 0 lands, chunk 1 is mid-Whisper when the Sidecar stops.
    hangAt = FOOTAGE_TARGET_CHUNK_SECONDS;
    const run1 = startRun();
    await run1.firstChunk;
    await Effect.runPromise(Fiber.interrupt(run1.fiber));
    expect(nodeFs.existsSync(`${footage}.transcript.json`)).toBe(false);

    // Run 2, the same Job put back: the cut and chunk 0 come from the cache.
    hangAt = null;
    whisperCalls = [];
    fullExtractions = 0;
    silenceDetections = 0;
    const run2 = startRun();
    await Effect.runPromise(Fiber.join(run2.fiber));

    expect(fullExtractions).toBe(0);
    expect(silenceDetections).toBe(0);
    expect(whisperCalls).toEqual([
      FOOTAGE_TARGET_CHUNK_SECONDS,
      FOOTAGE_TARGET_CHUNK_SECONDS * 2,
    ]);
    expect(
      run2.events
        .filter((e) => e.type === FOOTAGE_TRANSCRIPTION_EVENTS.chunkSettled)
        .map((e) => [e.data.index, e.data.cached])
    ).toEqual([
      [0, true],
      [1, false],
      [2, false],
    ]);
    const sidecar = JSON.parse(
      nodeFs.readFileSync(`${footage}.transcript.json`, "utf8")
    );
    expect(sidecar.words).toHaveLength(3);
  });

  it("never reuses a replaced file's chunks", async () => {
    hangAt = FOOTAGE_TARGET_CHUNK_SECONDS;
    const run1 = startRun();
    await run1.firstChunk;
    await Effect.runPromise(Fiber.interrupt(run1.fiber));

    nodeFs.writeFileSync(footage, "a re-recording");
    hangAt = null;
    whisperCalls = [];
    await Effect.runPromise(Fiber.join(startRun().fiber));

    expect(whisperCalls).toHaveLength(3);
  });

  it("fails, naming the file, when the footage is gone before it runs", async () => {
    nodeFs.rmSync(footage);
    const exit = await Effect.runPromiseExit(Fiber.join(startRun().fiber));
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("FootageFileMissingError");
  });
});
