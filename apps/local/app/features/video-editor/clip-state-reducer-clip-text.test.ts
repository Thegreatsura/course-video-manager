import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";

/** Edit Transcript in the editor (#2184), shared by Videos and Shorts. */

const clip = (overrides: Partial<ClipOnDatabase> = {}): ClipOnDatabase =>
  fromPartial({
    type: "on-database",
    frontendId: "f-a" as FrontendId,
    databaseId: "a" as DatabaseId,
    text: "I love type script",
    transcriptionStatus: "done",
    ...overrides,
  });

const tester = (items: ClipOnDatabase[]) =>
  new ReducerTester(clipStateReducer, {
    clipIdsWithTranscriptWords: new Set<DatabaseId>(),
    items,
    insertionPoint: { type: "end" },
    insertionOrder: 0,
    error: null,
    sessions: [],
    clipTranscriptionJobs: {},
    jobEventCursor: 0,
    micOffsetRefusal: null,
  });

const edit = (text: string) =>
  ({ type: "clip-text-edited", clipId: "f-a" as FrontendId, text }) as const;

describe("Edit Transcript in the editor", () => {
  it("shows the new text at once and saves it", () => {
    const t = tester([clip()]).send(edit("  I love TypeScript\n"));

    expect((t.getState().items[0] as ClipOnDatabase).text).toBe(
      "I love TypeScript"
    );
    expect(t.getEffects()).toEqual([
      { type: "update-clip-text", clipId: "a", text: "I love TypeScript" },
    ]);
  });

  it("saves nothing for an unchanged text or a Clip mid-Transcription", () => {
    expect(
      tester([clip()]).send(edit("I love type script")).getEffects()
    ).toEqual([]);

    const t = tester([clip({ transcriptionStatus: "transcribing" })]).send(
      edit("something else")
    );
    expect(t.getEffects()).toEqual([]);
    expect((t.getState().items[0] as ClipOnDatabase).text).toBe(
      "I love type script"
    );
  });
});
