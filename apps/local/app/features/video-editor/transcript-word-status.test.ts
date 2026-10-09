import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type ClipOptimisticallyAdded,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { createMockExec, ReducerTester } from "@/test-utils/reducer-tester";
import {
  clipTranscribed,
  clipTranscriptionFailed,
  transcriptionJobEnded,
} from "@/test-utils/transcription-job-events";
import { WHITE_NOISE_DEFAULTS } from "./clip-state-reducer-effect-clip-helpers";
import {
  anyClipsMissingTranscriptWords,
  getTranscriptWordStatus,
} from "./transcript-word-status";

const createState = (
  overrides: Partial<clipStateReducer.State> = {}
): clipStateReducer.State => ({
  clipIdsWithTranscriptWords: new Set(),
  items: [],
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
  clipTranscriptionJobs: {},
  jobEventCursor: 0,
  ...overrides,
});

const onDatabase = (
  id: string,
  overrides: Partial<ClipOnDatabase> = {}
): ClipOnDatabase =>
  fromPartial<ClipOnDatabase>({
    type: "on-database",
    frontendId: `f-${id}` as FrontendId,
    databaseId: id as DatabaseId,
    text: "hello world",
    scene: "Camera",
    transcriptionStatus: "done",
    ...overrides,
  });

const step = (
  state: clipStateReducer.State,
  action: clipStateReducer.Action
): clipStateReducer.State => clipStateReducer(state, action, createMockExec());

const clipIn = (state: clipStateReducer.State, databaseId: string) =>
  state.items.find(
    (item): item is ClipOnDatabase =>
      item.type === "on-database" && item.databaseId === databaseId
  )!;

describe("getTranscriptWordStatus", () => {
  it("a queued or running Transcription is transcribing, even with text and no words yet", () => {
    for (const transcriptionStatus of ["queued", "transcribing"] as const) {
      const clip = onDatabase("a", { transcriptionStatus });
      expect(getTranscriptWordStatus(clip, createState())).toBe("transcribing");
    }
  });

  it("a transcribed Clip with words has words", () => {
    const clip = onDatabase("a");
    const state = createState({
      clipIdsWithTranscriptWords: new Set([clip.databaseId]),
    });

    expect(getTranscriptWordStatus(clip, state)).toBe("has-words");
  });

  it("a failed Transcription with no words is failed, not missing", () => {
    const clip = onDatabase("a", { transcriptionStatus: "failed" });

    expect(getTranscriptWordStatus(clip, createState())).toBe("failed");
  });

  it("a failed re-transcribe keeps the words the Clip already had", () => {
    const clip = onDatabase("a", { transcriptionStatus: "failed" });
    const state = createState({
      clipIdsWithTranscriptWords: new Set([clip.databaseId]),
    });

    expect(getTranscriptWordStatus(clip, state)).toBe("has-words");
  });

  it("a transcribed Clip with text but no words is missing them", () => {
    expect(getTranscriptWordStatus(onDatabase("a"), createState())).toBe(
      "missing"
    );
  });

  it("an Effect Clip has nothing to time", () => {
    const clip = onDatabase("a", {
      text: WHITE_NOISE_DEFAULTS.text,
      scene: WHITE_NOISE_DEFAULTS.scene,
    });

    expect(getTranscriptWordStatus(clip, createState())).toBe(
      "nothing-to-time"
    );
  });

  it("a Clip in which nothing was said has nothing to time", () => {
    expect(
      getTranscriptWordStatus(onDatabase("a", { text: "  " }), createState())
    ).toBe("nothing-to-time");
  });
});

describe("a recorded Clip's Transcription", () => {
  const recorded = () =>
    new ReducerTester(clipStateReducer, createState()).send({
      type: "new-database-clips",
      clips: [
        fromPartial({ id: "a", text: "", transcriptionStatus: "queued" }),
      ],
      transcriptionJobId: "job-rec",
    });

  it("is transcribing from the moment the request goes out", () => {
    const tester = recorded();

    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe(
      "transcribing"
    );
    expect(
      getTranscriptWordStatus(clipIn(tester.getState(), "a"), tester.getState())
    ).toBe("transcribing");
    expect(tester.getEffects()).toContainEqual({
      type: "transcribe-clips",
      jobId: "job-rec",
      clipIds: ["a"],
    });
  });

  it("shows failed, not transcribing, when the server reports it failed", () => {
    const state = recorded()
      .send(clipTranscriptionFailed("job-rec", "a"))
      .getState();

    expect(clipIn(state, "a").transcriptionStatus).toBe("failed");
    expect(getTranscriptWordStatus(clipIn(state, "a"), state)).toBe("failed");
    expect(anyClipsMissingTranscriptWords(state)).toBe(false);
  });

  it("shows failed, not transcribing, when its Job ends without settling it, without taking the editor down", () => {
    const state = recorded()
      .send(transcriptionJobEnded("job-rec", "interrupted"))
      .getState();

    expect(clipIn(state, "a").transcriptionStatus).toBe("failed");
    expect(state.error).toBeNull();
  });

  it("can be retried after it failed, and lands", () => {
    const tester = recorded().send(transcriptionJobEnded("job-rec"));
    const failedClip = clipIn(tester.getState(), "a");

    tester.send({
      type: "clips-retranscribing",
      clipIds: [failedClip.frontendId],
      jobId: "job-retry",
    });
    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe(
      "transcribing"
    );

    const state = tester
      .send(clipTranscribed("job-retry", "a", "hello"))
      .getState();

    expect(clipIn(state, "a")).toMatchObject({
      text: "hello",
      transcriptionStatus: "done",
    });
    expect(getTranscriptWordStatus(clipIn(state, "a"), state)).toBe(
      "has-words"
    );
    expect(
      tester.getEffects().filter((effect) => effect.type === "transcribe-clips")
    ).toEqual([
      { type: "transcribe-clips", jobId: "job-rec", clipIds: ["a"] },
      { type: "transcribe-clips", jobId: "job-retry", clipIds: ["a"] },
    ]);
  });
});

describe("anyClipsMissingTranscriptWords", () => {
  it("is false while a freshly recorded Clip is queued for transcription", () => {
    const state = step(createState(), {
      type: "new-database-clips",
      clips: [
        fromPartial({ id: "a", text: "", transcriptionStatus: "queued" }),
      ],
      transcriptionJobId: "job-rec",
    });

    expect(anyClipsMissingTranscriptWords(state)).toBe(false);
  });

  it("is false while an old Clip with no words is being re-transcribed", () => {
    const clip = onDatabase("a");
    const before = createState({ items: [clip] });
    expect(anyClipsMissingTranscriptWords(before)).toBe(true);

    const during = step(before, {
      type: "clips-retranscribing",
      clipIds: [clip.frontendId],
      jobId: "job-1",
    });

    expect(anyClipsMissingTranscriptWords(during)).toBe(false);
  });

  it("stays false when the text and the words land together", () => {
    const clip = onDatabase("a", {
      text: "",
      transcriptionStatus: "transcribing",
    });

    const after = step(
      createState({ items: [clip] }),
      clipTranscribed("job-1", "a", "hello", true)
    );

    expect(anyClipsMissingTranscriptWords(after)).toBe(false);
  });

  it("is true when a Transcription lands with text but no words", () => {
    const clip = onDatabase("a", {
      text: "",
      transcriptionStatus: "transcribing",
    });
    const during = createState({
      items: [clip],
      clipIdsWithTranscriptWords: new Set([clip.databaseId]),
    });

    const after = step(during, clipTranscribed("job-1", "a", "hello", false));

    expect(after.clipIdsWithTranscriptWords.size).toBe(0);
    expect(anyClipsMissingTranscriptWords(after)).toBe(true);
  });

  it("finishes a Transcription that heard nothing, without warning", () => {
    const clip = onDatabase("a", {
      text: "",
      transcriptionStatus: "transcribing",
    });

    const after = step(
      createState({ items: [clip] }),
      clipTranscribed("job-1", "a", "", false)
    );

    expect(clipIn(after, "a").transcriptionStatus).toBe("done");
    expect(anyClipsMissingTranscriptWords(after)).toBe(false);
  });

  it("ignores Effect Clips, archived Clips and Clips still being recorded", () => {
    const state = createState({
      items: [
        onDatabase("effect", {
          text: WHITE_NOISE_DEFAULTS.text,
          scene: WHITE_NOISE_DEFAULTS.scene,
        }),
        onDatabase("archived", { shouldArchive: true }),
        fromPartial<ClipOptimisticallyAdded>({
          type: "optimistically-added",
          frontendId: "f-recording" as FrontendId,
        }),
      ],
    });

    expect(anyClipsMissingTranscriptWords(state)).toBe(false);
  });
});
