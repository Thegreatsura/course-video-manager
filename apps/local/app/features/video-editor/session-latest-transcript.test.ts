import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  FrontendId,
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import { getLatestSessionTranscript } from "./session-latest-transcript";

const SESSION = "session-1" as SessionId;
const OLDER = "session-0" as SessionId;

const session = (id: SessionId, displayNumber: number): RecordingSession =>
  fromPartial({ id, displayNumber, status: "recording" });

const onDatabase = (
  insertionOrder: number | null,
  text: string,
  overrides: Partial<ClipOnDatabase> = {}
): TimelineItem =>
  fromPartial<ClipOnDatabase>({
    type: "on-database",
    frontendId: `f-db-${insertionOrder}` as FrontendId,
    insertionOrder,
    text,
    sessionId: SESSION,
    ...overrides,
  });

const optimistic = (insertionOrder: number): TimelineItem =>
  fromPartial<ClipOptimisticallyAdded>({
    type: "optimistically-added",
    frontendId: `f-${insertionOrder}` as FrontendId,
    insertionOrder,
    sessionId: SESSION,
  });

describe("getLatestSessionTranscript", () => {
  it("reports nothing before the first recording session", () => {
    expect(getLatestSessionTranscript([onDatabase(1, "Hello")], [])).toBe(null);
  });

  it("picks the most recently spoken clip, not the last on the timeline", () => {
    const transcript = getLatestSessionTranscript(
      [onDatabase(3, "Third"), onDatabase(1, "First"), onDatabase(2, "Second")],
      [session(SESSION, 1)]
    );
    expect(transcript).toBe("Third");
  });

  it("skips clips still waiting on a transcript", () => {
    const transcript = getLatestSessionTranscript(
      [onDatabase(1, "First"), onDatabase(2, ""), optimistic(3)],
      [session(SESSION, 1)]
    );
    expect(transcript).toBe("First");
  });

  it("includes a deleted take, since that's the one worth reading back", () => {
    const transcript = getLatestSessionTranscript(
      [
        onDatabase(1, "Good"),
        onDatabase(2, "Fluffed", { shouldArchive: true }),
      ],
      [session(SESSION, 1)]
    );
    expect(transcript).toBe("Fluffed");
  });

  it("ignores clips from older sessions and from page load", () => {
    const transcript = getLatestSessionTranscript(
      [
        onDatabase(5, "Older session", { sessionId: OLDER }),
        onDatabase(9, "Loaded on page load", { sessionId: undefined }),
      ],
      [session(OLDER, 1), session(SESSION, 2)]
    );
    expect(transcript).toBe(null);
  });
});
