import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  clipTranscribed,
  transcriptionJobEnded,
  transcriptionJobStarted,
} from "@/test-utils/transcription-job-events";

const onDatabase = (id: string): ClipOnDatabase =>
  fromPartial<ClipOnDatabase>({
    type: "on-database",
    frontendId: `f-${id}` as FrontendId,
    databaseId: id as DatabaseId,
    text: "old text",
    transcriptionStatus: "done",
  });
const statusOf = (state: clipStateReducer.State, id: string) =>
  state.items.find(
    (item): item is ClipOnDatabase =>
      item.type === "on-database" && item.databaseId === id
  )!.transcriptionStatus;

// From review b7: an old Job ending failed/interrupted must not fail a Clip
// this tab has already asked to re-transcribe.
describe("an old Job's failure vs a re-transcribe this tab already asked for", () => {
  it("keeps the Clip transcribing while the newer Job is queued, and after it starts", () => {
    const tester = new ReducerTester(clipStateReducer, {
      clipIdsWithTranscriptWords: new Set<DatabaseId>(),
      items: [onDatabase("a"), onDatabase("b")],
      insertionPoint: { type: "end" },
      insertionOrder: 0,
      error: null,
      sessions: [],
      clipTranscriptionJobs: {},
      jobEventCursor: 0,
    })
      .send({
        type: "clips-retranscribing",
        clipIds: ["f-a", "f-b"] as FrontendId[],
        jobId: "job-1",
      })
      .send(transcriptionJobStarted("job-1", ["a", "b"]))
      .send(clipTranscribed("job-1", "a", "x"))
      // The author asks again (job-2 enqueued, still queued) ...
      .send({
        type: "clips-retranscribing",
        clipIds: ["f-a", "f-b"] as FrontendId[],
        jobId: "job-2",
      })
      // ... and job-1 is then settled `interrupted` by recovery.
      .send(transcriptionJobEnded("job-1", "interrupted"));

    expect(statusOf(tester.getState(), "b")).toBe("transcribing");

    tester.send(transcriptionJobStarted("job-2", ["a", "b"]));
    expect(statusOf(tester.getState(), "b")).toBe("transcribing");
    expect(tester.getEffects()).toEqual([
      { type: "transcribe-clips", jobId: "job-1", clipIds: ["a", "b"] },
      { type: "transcribe-clips", jobId: "job-2", clipIds: ["a", "b"] },
    ]);
  });
});
