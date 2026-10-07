import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type ClipOptimisticallyAdded,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { createMockExec } from "@/test-utils/reducer-tester";
import { WHITE_NOISE_DEFAULTS } from "./clip-state-reducer-effect-clip-helpers";
import {
  anyClipsMissingTranscriptWords,
  getTranscriptWordStatus,
} from "./transcript-word-status";

const createState = (
  overrides: Partial<clipStateReducer.State> = {}
): clipStateReducer.State => ({
  clipIdsBeingTranscribed: new Set(),
  clipIdsWithTranscriptWords: new Set(),
  items: [],
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
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
    ...overrides,
  });

const step = (
  state: clipStateReducer.State,
  action: clipStateReducer.Action
): clipStateReducer.State => clipStateReducer(state, action, createMockExec());

describe("getTranscriptWordStatus", () => {
  it("a Clip being transcribed is transcribing, even with text and no words yet", () => {
    const clip = onDatabase("a");
    const state = createState({
      clipIdsBeingTranscribed: new Set([clip.frontendId]),
    });

    expect(getTranscriptWordStatus(clip, state)).toBe("transcribing");
  });

  it("a transcribed Clip with words has words", () => {
    const clip = onDatabase("a");
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

describe("anyClipsMissingTranscriptWords", () => {
  it("is false while a freshly recorded Clip is queued for transcription", () => {
    const state = step(createState(), {
      type: "new-database-clips",
      clips: [fromPartial({ id: "a", text: "" })],
    });

    expect(state.clipIdsBeingTranscribed.size).toBe(1);
    expect(anyClipsMissingTranscriptWords(state)).toBe(false);
  });

  it("is false while an old Clip with no words is being re-transcribed", () => {
    const clip = onDatabase("a");
    const before = createState({ items: [clip] });
    expect(anyClipsMissingTranscriptWords(before)).toBe(true);

    const during = step(before, {
      type: "clips-retranscribing",
      clipIds: [clip.frontendId],
    });

    expect(anyClipsMissingTranscriptWords(during)).toBe(false);
  });

  it("stays false when the text and the words land together", () => {
    const clip = onDatabase("a", { text: "" });
    const during = createState({
      items: [clip],
      clipIdsBeingTranscribed: new Set([clip.frontendId]),
    });

    const after = step(during, {
      type: "clips-transcribed",
      clips: [
        {
          databaseId: clip.databaseId,
          text: "hello",
          hasTranscriptWords: true,
        },
      ],
    });

    expect(after.clipIdsBeingTranscribed.size).toBe(0);
    expect(anyClipsMissingTranscriptWords(after)).toBe(false);
  });

  it("is true when a Transcription lands with text but no words", () => {
    const clip = onDatabase("a", { text: "" });
    const during = createState({
      items: [clip],
      clipIdsBeingTranscribed: new Set([clip.frontendId]),
      clipIdsWithTranscriptWords: new Set([clip.databaseId]),
    });

    const after = step(during, {
      type: "clips-transcribed",
      clips: [
        {
          databaseId: clip.databaseId,
          text: "hello",
          hasTranscriptWords: false,
        },
      ],
    });

    expect(after.clipIdsWithTranscriptWords.size).toBe(0);
    expect(anyClipsMissingTranscriptWords(after)).toBe(true);
  });

  it("finishes a Transcription that heard nothing, without warning", () => {
    const clip = onDatabase("a", { text: "" });
    const during = createState({
      items: [clip],
      clipIdsBeingTranscribed: new Set([clip.frontendId]),
    });

    const after = step(during, {
      type: "clips-transcribed",
      clips: [
        { databaseId: clip.databaseId, text: "", hasTranscriptWords: false },
      ],
    });

    expect(after.clipIdsBeingTranscribed.size).toBe(0);
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
