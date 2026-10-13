import { ConfigProvider, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { NodeContext } from "@effect/platform-node";
import { SidecarContextTest } from "@/services/sidecar-context";
import { transcribeAndStoreClips } from "./clip-transcription.server";

const SESSION_DIR = "/mnt/d/recordings/2026-10-11 abcd1234";
const MIC = `${SESSION_DIR}/mic.mkv`;

/** A CVM-recorder Clip at picture 0.05–4.05, its mic 150 ms behind. */
const earlyClip = {
  id: "clip-1",
  videoFilename: MIC,
  sourceStartTime: 0.05,
  sourceEndTime: 4.05,
  text: "",
  recordingSessionId: "session-1",
  sceneOverride: null,
  recordingSession: {
    id: "session-1",
    cameraFilePath: `${SESSION_DIR}/camera.mkv`,
    screenFilePath: `${SESSION_DIR}/screen.mkv`,
    micFilePath: MIC,
    micOffsetMs: 150,
    micEq: null,
    sceneEvents: [{ fileTime: 0, scene: "Code" as const }],
  },
};

describe("transcribing a CVM-recorder Clip that starts within the mic offset", () => {
  it("hears its mic from 0 and stores its words in the Clip's clock", async () => {
    const heard: unknown[] = [];
    let stored: unknown;
    const clipOps = Layer.succeed(ClipOperationsService, {
      getClipsWithRecordingSessionByIds: () => Effect.succeed([earlyClip]),
      setTranscriptionStatus: () => Effect.void,
      updateClip: (id: string, patch: { text: string }) =>
        Effect.succeed({ id, text: patch.text }),
      replaceTranscriptWords: (_id: string, words: unknown[]) => {
        stored = words;
        return Effect.succeed(words);
      },
    } as unknown as ClipOperationsService);
    // Stands in for ffmpeg + Whisper: what it is asked to read is what ffmpeg
    // would be given as -ss/-t, and its timings are relative to that read.
    const whisper = Layer.succeed(WhisperTranscriptionService, {
      transcribeClips: (clips: ReadonlyArray<{ id: string }>) => {
        heard.push(...clips);
        return Effect.succeed(
          clips.map((c) => ({
            id: c.id,
            words: [{ start: 0.5, end: 1, text: "hello" }],
            segments: [{ start: 0.5, end: 1, text: "hello" }],
          }))
        );
      },
    } as unknown as WhisperTranscriptionService);

    const [result] = await Effect.runPromise(
      transcribeAndStoreClips(["clip-1"]).pipe(
        Effect.provide(
          Layer.mergeAll(
            clipOps,
            whisper,
            NodeContext.layer,
            SidecarContextTest,
            // Its Footage is under no Storage Root, so is read where it is.
            Layer.setConfigProvider(
              ConfigProvider.fromMap(
                new Map([["STORAGE_ROOTS", "/no-such-storage-root"]])
              )
            )
          )
        )
      )
    );

    // Mic −0.1–3.9 is read as 0–3.9: never a negative -ss, never short.
    expect(heard).toEqual([
      { id: "clip-1", inputVideo: MIC, startTime: 0, duration: 3.9 },
    ]);
    // Heard 0.5 s into the read is 0.6 s into the Clip.
    expect(stored).toEqual([{ start: 0.6, end: 1.1, text: "hello" }]);
    expect(result).toMatchObject({ transcriptionStatus: "done" });
  });
});
